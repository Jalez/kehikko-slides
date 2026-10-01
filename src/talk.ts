import { useEffect, useRef } from 'react'

import type { PresentState } from '../deck/api.ts'
import type { Decks } from './wire/decks.ts'

/**
 * Keeping two windows on one talk: the stage and the presenter view each post
 * their moves to `/api/present` and follow its event stream. The server echoes
 * every move to everybody, including the window that made it, so each side
 * has to tell its own echoes from the other's moves — or a fast run of key
 * presses would be pulled back through every slide it passed.
 */

/** What a key press asks of a talk. */
export type TalkKey = 'next' | 'previous' | 'first' | 'last' | 'blank' | 'leave'

export function talkKey(key: string): TalkKey | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
    case 'Spacebar':
    case 'PageDown':
      return 'next'
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return 'previous'
    case 'Home':
      return 'first'
    case 'End':
      return 'last'
    case 'b':
    case 'B':
      return 'blank'
    case 'Escape':
      return 'leave'
    default:
      return null
  }
}

/** Where a key press takes a talk of `count` slides. */
export function step(key: TalkKey, at: { index: number; blank: boolean }, count: number): { index: number; blank: boolean } {
  const last = Math.max(0, count - 1)
  switch (key) {
    case 'next':
      return { index: Math.min(at.index + 1, last), blank: false }
    case 'previous':
      return { index: Math.max(at.index - 1, 0), blank: false }
    case 'first':
      return { index: 0, blank: false }
    case 'last':
      return { index: last, blank: false }
    case 'blank':
      return { index: at.index, blank: !at.blank }
    default:
      return at
  }
}

const keyOf = (index: number, blank: boolean) => `${index}:${blank ? 1 : 0}`

/**
 * One window's side of the sync.
 *
 * - `toPost` says whether a position is new and should be posted;
 * - `heard` says whether an event is somebody else's move to take, or null
 *   for our own echo, a repeat, or a state from before this window joined.
 */
export class TalkSync {
  private posted: string[] = []
  private last: string | null = null

  /** `since`: ignore states last moved before this (ms); null takes whatever the server holds. */
  constructor(private since: number | null = null) {}

  toPost(index: number, blank: boolean): boolean {
    const key = keyOf(index, blank)
    if (key === this.last) return false
    this.last = key
    this.posted.push(key)
    if (this.posted.length > 50) this.posted.shift()
    return true
  }

  heard(state: PresentState): { index: number; blank: boolean } | null {
    const key = keyOf(state.index, state.blank)
    const own = this.posted.indexOf(key)
    if (own >= 0) {
      /* Our echo; anything posted before it has been answered too. */
      this.posted.splice(0, own + 1)
      return null
    }
    if (this.since !== null && state.at < this.since) return null
    if (key === this.last) return null
    this.last = key
    return { index: state.index, blank: state.blank }
  }
}

/**
 * Post this window's position while `active`, and hand `onMove` the other
 * window's moves. `index` null: this window does not know where the talk is
 * yet (the presenter view, before the first event) and posts nothing.
 */
export function useTalk({
  decks,
  project,
  slug,
  active,
  index,
  blank,
  since,
  onMove,
}: {
  decks: Decks
  project: string | null
  slug: string
  active: boolean
  index: number | null
  blank: boolean
  /** See `TalkSync`. */
  since: number | null
  onMove(to: { index: number; blank: boolean }): void
}): void {
  const sync = useRef<TalkSync | null>(null)
  const move = useRef(onMove)
  move.current = onMove

  useEffect(() => {
    if (!active || !project) return
    const mine = new TalkSync(since)
    sync.current = mine
    const stop = decks.followTalk(project, slug, (state) => {
      const to = mine.heard(state)
      if (to) move.current(to)
    })
    return () => {
      stop()
      if (sync.current === mine) sync.current = null
    }
  }, [active, project, slug, decks, since])

  useEffect(() => {
    if (!active || !project || index === null || !sync.current) return
    if (!sync.current.toPost(index, blank)) return
    void decks.present(project, slug, index, blank).catch(() => {
      /* A lost move is caught up by the next one; the talk is not stopped for it. */
    })
  }, [active, project, slug, index, blank, decks])
}
