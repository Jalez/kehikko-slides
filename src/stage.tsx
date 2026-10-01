import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'

import { SlideView } from '@/slides/slide-view'

import type { Aspect, Slide } from '../deck/format.ts'
import { step, talkKey } from './talk.ts'

/**
 * How the deck is being presented: `fullscreen` through the Fullscreen API,
 * or `window` — filling the frame — where that API is missing or refuses
 * (the desktop app's web view may not grant element full screen).
 */
export type Presenting = 'fullscreen' | 'window' | null

export const FALLBACK_NOTE = 'Full screen is not available here, so the slides fill the window instead. Esc leaves.'

/**
 * Presenting the open deck: entering and leaving full screen, the keys, and
 * blanking. Moves go through `goTo`, the same path a thumbnail press takes,
 * so the paper is turned and the presenter view told exactly as for any move.
 */
export function usePresenting({
  stage,
  index,
  count,
  goTo,
}: {
  stage: RefObject<HTMLElement | null>
  index: number
  count: number
  goTo(index: number): void
}) {
  const [presenting, setPresenting] = useState<Presenting>(null)
  const [blank, setBlank] = useState(false)
  /* When this run of presenting began: talk states older than it are a previous talk's. */
  const [since, setSince] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const told = useRef(false)

  const leave = useCallback(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    setPresenting(null)
    setBlank(false)
    setSince(null)
    setNote(null)
  }, [])

  const start = useCallback(() => {
    const fallBack = () => {
      setPresenting('window')
      /* Said once per screen: after that the person knows. */
      if (!told.current) {
        told.current = true
        setNote(FALLBACK_NOTE)
      }
    }
    /* Shown before full screen is asked for, so the element that goes full screen has something in it. */
    flushSync(() => {
      setPresenting('fullscreen')
      setBlank(false)
      setSince(Date.now())
    })
    const element = stage.current
    if (!element || typeof element.requestFullscreen !== 'function') return fallBack()
    try {
      Promise.resolve(element.requestFullscreen()).catch(fallBack)
    } catch {
      fallBack()
    }
  }, [stage])

  /* Leaving full screen by the browser's own means (Esc, a gesture) ends the talk. */
  useEffect(() => {
    if (presenting !== 'fullscreen') return
    const changed = () => {
      if (!document.fullscreenElement) leave()
    }
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [presenting, leave])

  const at = useRef({ index, blank, count, goTo })
  at.current = { index, blank, count, goTo }

  useEffect(() => {
    if (!presenting) return
    const down = (event: KeyboardEvent) => {
      const key = talkKey(event.key)
      if (!key || event.metaKey || event.ctrlKey || event.altKey) return
      /* Captured, so the editor behind the stage never types the space. */
      event.preventDefault()
      event.stopPropagation()
      if (key === 'leave') return leave()
      const now = at.current
      const next = step(key, { index: now.index, blank: now.blank }, now.count)
      if (next.index !== now.index) now.goTo(next.index)
      setBlank(next.blank)
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [presenting, leave])

  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), 5000)
    return () => clearTimeout(timer)
  }, [note])

  return { presenting, blank, setBlank, since, note, start, leave }
}

/** The stage: always mounted, so it can be asked to go full screen within the press that asked. */
export function Stage({
  stage,
  presenting,
  slide,
  aspect,
  blank,
  note,
}: {
  stage: RefObject<HTMLDivElement | null>
  presenting: Presenting
  slide: Slide | undefined
  aspect: Aspect
  blank: boolean
  note: string | null
}) {
  return (
    <div
      ref={stage}
      data-testid="stage"
      data-presenting={presenting ?? undefined}
      role={presenting ? 'dialog' : undefined}
      aria-label={presenting ? 'presenting' : undefined}
      className={presenting ? 'fixed inset-0 z-50 flex bg-black' : 'hidden'}
    >
      {presenting && slide && !blank ? <SlideView slide={slide} aspect={aspect} /> : null}
      {presenting && note ? (
        <p
          role="status"
          className="bg-background/90 text-foreground absolute top-3 left-1/2 -translate-x-1/2 rounded-md px-3 py-1 text-xs shadow"
        >
          {note}
        </p>
      ) : null}
    </div>
  )
}
