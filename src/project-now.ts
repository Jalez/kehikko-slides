import { useCallback, useEffect, useRef, useState } from 'react'

import { AskFailed } from 'kehikot-module-protocol/client'

import type { Decks } from './wire/decks.ts'

/**
 * The folder a window of its own (the presenter view, the print view) should work on.
 *
 * Such a window is opened on a path and a project id and has no host to tell it more. A folder renamed
 * or moved after that is the same project at another path, so the window asks its own server where the
 * project is now (`decks.where`, which asks the host): when it opens, when it is looked at again, and when
 * something it read failed (`recheck`). A folder that is now another project, or none, is `refused`, with
 * the sentence to say: a window never shows a deck of a project it was not opened on.
 *
 * A server that does not answer changes nothing: the window keeps the path it has.
 */
export function useProjectNow(
  decks: Decks,
  opened: string | null,
  projectId: string | null,
): { project: string | null; refused: string | null; recheck: () => void } {
  const [project, setProject] = useState(opened)
  const [refused, setRefused] = useState<string | null>(null)
  const at = useRef(opened)
  const alive = useRef(true)

  const recheck = useCallback(() => {
    const asked = at.current
    if (!asked) return
    decks.where(asked, projectId).then(
      (found) => {
        if (!alive.current) return
        at.current = found.project
        setProject(found.project)
        setRefused(null)
      },
      (caught: unknown) => {
        if (alive.current && caught instanceof AskFailed && caught.status === 404) setRefused(caught.message)
      },
    )
  }, [decks, projectId])

  useEffect(() => {
    alive.current = true
    at.current = opened
    setProject(opened)
    setRefused(null)
    recheck()
    const again = () => {
      if (document.visibilityState !== 'hidden') recheck()
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      alive.current = false
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [opened, recheck])

  return { project, refused, recheck }
}
