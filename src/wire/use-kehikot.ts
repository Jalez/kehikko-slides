import { useEffect, useMemo } from 'react'

import type { EpicPart } from 'kehikot-module-protocol'
import { useKehikot as useProtocolKehikot, type Kehikot, type Where } from 'kehikot-module-protocol/client/react'

import type { PassageLike } from '../follow.ts'

import { ID } from '../../manifest.ts'

/**
 * What the screen needs from the host, and nothing about how it arrived.
 *
 * A thin wrapper over the protocol's `useKehikot`: it applies the host's theme
 * to <html> and flattens the context into the fields this module reads, so a
 * screen can be rendered in a test with a plain object (see `Host`).
 */
export interface Host {
  /** 'listening' until a host greets or the grace runs out; then 'hosted' or 'unhosted'. */
  where: Where
  project: string | null
  /** The absolute directory of the open project. Where this module keeps its data. */
  projectPath: string | null
  epic: string | null
  theme: 'light' | 'dark'
  /**
   * Where a reader on the canvas is pointing: an ABSOLUTE path, and the
   * section being read (`section`) when a paper publishes one. Null when
   * nobody is pointing anywhere.
   */
  passage: PassageLike | null
  /** `context.parts`: the open epic's parts, the ones ticked in the host's bar flagged. Empty is the whole epic. */
  parts: readonly EpicPart[]
  /** Ask the host for something (a method from the protocol). Rejects when unhosted. */
  request: Kehikot['request']
}

const NO_PARTS: readonly EpicPart[] = []

export function useKehikot(): Host {
  const kehikot = useProtocolKehikot(ID)
  const context = kehikot.context
  const theme = context?.theme ?? 'light'

  useEffect(() => {
    if (!context) return
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
  }, [context, theme])

  return useMemo(
    () => ({
      where: kehikot.where,
      project: context?.project ?? null,
      projectPath: context?.projectPath ?? null,
      epic: context?.epic ?? null,
      theme,
      passage: context?.passage ?? null,
      parts: context?.parts ?? NO_PARTS,
      request: kehikot.request,
    }),
    [kehikot.where, kehikot.request, context, theme],
  )
}
