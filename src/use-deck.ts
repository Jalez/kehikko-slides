import { useCallback, useEffect, useRef, useState } from 'react'

import type { Version, WatchEvent } from '../deck/api.ts'
import type { Decks } from './wire/decks.ts'

/** The quiet word in the header about where the open deck's text stands. */
export type SaveState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'conflict' | 'failed'

/**
 * Why the editor is showing a notice instead of quietly carrying on:
 * - `conflict`: a save was refused, somebody wrote since our base;
 * - `changed`: the deck changed on disk (an agent, another window) while we
 *   held unsaved edits, so it was not reloaded under the person's hands.
 */
export type Notice = { kind: 'conflict' | 'changed' } | null

export interface DeckDoc {
  /** Null until the first read lands. */
  text: string | null
  state: SaveState
  error: string | null
  notice: Notice
  edit(text: string): void
  /** Throw away local edits and take what is on disk. */
  reload(): Promise<void>
  /** Write the local text over whatever is on disk. */
  overwrite(): Promise<void>
}

/**
 * One open deck: read it, autosave edits (debounced, with the version they
 * were made from as `base`), and keep up with writes from elsewhere.
 *
 * Mount it once per deck (key the component by slug): switching decks is a
 * fresh session, and an unmount with edits pending writes them on the way out.
 *
 * `watched` is the project's latest watch event; one that names this deck at
 * a version we did not write reloads it, unless there are unsaved edits, in
 * which case it raises the `changed` notice instead.
 */
export function useDeck({
  decks,
  project,
  slug,
  watched,
  saveDelay = 600,
}: {
  decks: Decks
  project: string
  slug: string
  watched: WatchEvent | null
  saveDelay?: number
}): DeckDoc {
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<SaveState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  /* The truth the async work reads, kept outside render so a late reply sees today's values. */
  const current = useRef<string | null>(null)
  const saved = useRef<string | null>(null)
  const version = useRef<Version | undefined>(undefined)
  const ours = useRef(new Set<Version>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef(false)
  const held = useRef<WatchEvent | null>(null)
  const blocked = useRef(false)
  const alive = useRef(true)

  const take = useCallback((next: { text: string; version: Version }) => {
    current.current = next.text
    saved.current = next.text
    version.current = next.version
    blocked.current = false
    setText(next.text)
    setNotice(null)
    setState('saved')
    setError(null)
  }, [])

  const load = useCallback(async () => {
    try {
      const read = await decks.read(project, slug)
      if (alive.current) take(read)
    } catch (caught) {
      if (!alive.current) return
      setError(message(caught))
      setState('failed')
    }
  }, [decks, project, slug, take])

  const dirty = () => current.current !== null && current.current !== saved.current

  /* Declared before `flush` reads it, through a ref, so the two can call each other. */
  const onWatch = useRef<(event: WatchEvent) => void>(() => {})

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (saving.current || blocked.current || !dirty()) return
    const sent = current.current as string
    saving.current = true
    if (alive.current) setState('saving')
    try {
      const result = await decks.save(project, slug, sent, version.current)
      if (result.ok) {
        version.current = result.version
        ours.current.add(result.version)
        saved.current = sent
        if (alive.current) setState(dirty() ? 'unsaved' : 'saved')
      } else {
        blocked.current = true
        if (alive.current) {
          setNotice({ kind: 'conflict' })
          setState('conflict')
        }
      }
    } catch (caught) {
      if (alive.current) {
        setError(message(caught))
        setState('failed')
      }
    } finally {
      saving.current = false
    }
    const waiting = held.current
    held.current = null
    if (waiting) onWatch.current(waiting)
    if (dirty() && !blocked.current && alive.current) schedule()
  }, [decks, project, slug])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), saveDelay)
  }, [flush, saveDelay])

  onWatch.current = (event: WatchEvent) => {
    if (event.slug !== slug) return
    /* Our own write may be announced before its reply lands: decide once it has. */
    if (saving.current) {
      held.current = event
      return
    }
    /* Deleted on disk: re-reading says so in the screen's own words. */
    if (event.version === null) {
      void load()
      return
    }
    if (event.version === version.current || ours.current.has(event.version)) return
    if (dirty()) {
      blocked.current = true
      setNotice({ kind: 'changed' })
      return
    }
    void load()
  }

  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
      /* Leaving with edits not yet written: write them now rather than drop them. */
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        if (dirty() && !blocked.current) void decks.save(project, slug, current.current as string, version.current)
      }
    }
  }, [load, decks, project, slug])

  useEffect(() => {
    if (watched) onWatch.current(watched)
  }, [watched])

  const edit = useCallback(
    (next: string) => {
      current.current = next
      setText(next)
      if (blocked.current) return
      setState(dirty() ? 'unsaved' : 'saved')
      if (dirty()) schedule()
    },
    [schedule],
  )

  const reload = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await load()
  }, [load])

  const overwrite = useCallback(async () => {
    try {
      const there = await decks.read(project, slug)
      version.current = there.version
      blocked.current = false
      setNotice(null)
      await flush()
    } catch (caught) {
      setError(message(caught))
      setState('failed')
    }
  }, [decks, project, slug, flush])

  return { text, state, error, notice, edit, reload, overwrite }
}

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
