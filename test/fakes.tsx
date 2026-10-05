import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'

import type { DeckSummary, HistoryEntry, PresentState, Version, WatchEvent } from '../deck/api.ts'
import { Screen } from '../src/app.tsx'
import type { EditorProps } from '../src/editor/deck-editor.tsx'
import type { Decks, SaveResult } from '../src/wire/decks.ts'
import type { Host } from '../src/wire/use-kehikot.ts'

/* The fakes the screen tests share: a host, an in-memory store, a textarea for CodeMirror. */

export function host(over: Partial<Host> = {}): Host {
  return {
    where: 'hosted',
    project: 'Thesis',
    projectPath: '/work/thesis',
    epic: 'write-chapter-two',
    theme: 'dark',
    passage: null,
    request: () => Promise.resolve(null),
    ...over,
  }
}

export const DECK = `---
title: Defence
---

<!-- layout: title -->
# Bridging the gap
A thesis defence

---

## The problem
- one
- two

Notes:
Never shown.

---

## The answer
- three
`

interface Call {
  method: string
  args: unknown[]
}

/** An in-memory `Decks`: records every call; `watch` hands back an `emit`. */
export function fakeDecks(
  over: Partial<Decks> = {},
  start: { list?: DeckSummary[]; text?: string; version?: Version; history?: HistoryEntry[] } = {},
) {
  const calls: Call[] = []
  const listeners: ((event: WatchEvent) => void)[] = []
  const talkers = new Set<(state: PresentState) => void>()
  const disk = { text: start.text ?? DECK, version: (start.version ?? 'v1') as Version }
  let list: DeckSummary[] = start.list ?? [
    { slug: 'defence', title: 'Defence', epic: 'write-chapter-two', slides: 3, updated: 0 },
  ]
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })

  const decks: Decks = {
    async list(project) {
      record('list', project)
      return list
    },
    async read(project, slug) {
      record('read', project, slug)
      return { ...disk }
    },
    async save(project, slug, text, base): Promise<SaveResult> {
      record('save', project, slug, text, base)
      if (base !== undefined && base !== disk.version) return { ok: false, conflict: { ...disk } }
      disk.text = text
      disk.version = `v${Number(String(disk.version).slice(1)) + 1}`
      return { ok: true, version: disk.version }
    },
    async create(project, title, epic) {
      record('create', project, title, epic)
      const slug = title.toLowerCase().replace(/\W+/g, '-')
      list = [...list, { slug, title, epic: epic ?? null, slides: 1, updated: 0 }]
      return slug
    },
    async retitle(project, slug, title) {
      record('retitle', project, slug, title)
      list = list.map((one) => (one.slug === slug ? { ...one, title } : one))
    },
    async remove(project, slug) {
      record('remove', project, slug)
      list = list.filter((one) => one.slug !== slug)
    },
    async history(project, slug) {
      record('history', project, slug)
      return start.history ?? []
    },
    async undo(project, slug, id) {
      record('undo', project, slug, id)
    },
    watch(project, onChange) {
      record('watch', project)
      listeners.push(onChange)
      return () => {}
    },
    async present(project, slug, index, blank) {
      record('present', project, slug, index, blank)
    },
    followTalk(project, slug, onState) {
      record('followTalk', project, slug)
      talkers.add(onState)
      return () => talkers.delete(onState)
    },
    async citations(project, slug) {
      record('citations', project, slug)
      return []
    },
    async source(project, path, from, to) {
      record('source', project, path, from, to)
      return ''
    },
    ...over,
  }
  return {
    decks,
    calls,
    disk,
    of: (method: string) => calls.filter((call) => call.method === method),
    emit: (event: WatchEvent) => act(() => listeners.forEach((listen) => listen(event))),
    /** The server saying where the talk is, to every window following it. */
    talk: (state: Omit<PresentState, 'slug'> & { slug?: string }) =>
      act(() => talkers.forEach((listen) => listen({ slug: 'defence', ...state }))),
  }
}

/** CodeMirror stands in as a textarea: same props, and it reports the caret on select. */
export const jumps: number[] = []
export function FakeEditor({ value, onChange, onCaret, jump }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!jump || !ref.current) return
    ref.current.selectionStart = jump.at
    jumps.push(jump.at)
  }, [jump])
  return (
    <textarea
      ref={ref}
      aria-label="deck markdown"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onSelect={(event) => onCaret(event.currentTarget.selectionStart)}
    />
  )
}

export const draw = (fake: ReturnType<typeof fakeDecks>, over: Partial<Host> = {}, saveDelay = 20) =>
  render(<Screen host={host(over)} decks={fake.decks} editor={FakeEditor} saveDelay={saveDelay} />)

export const editor = () => screen.getByLabelText('deck markdown') as HTMLTextAreaElement
export const preview = () => within(screen.getByRole('region', { name: 'preview' }))
export const caretAt = (at: number) => {
  editor().setSelectionRange(at, at)
  fireEvent.select(editor())
}
export const type = (text: string) => fireEvent.change(editor(), { target: { value: text } })
export const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
