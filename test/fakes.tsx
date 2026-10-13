import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'

import type { DeckSummary, HistoryEntry, PointerState, PresentState, Version, WatchEvent } from '../deck/api.ts'
import { Screen } from '../src/app.tsx'
import type { EditorProps } from '../src/editor/deck-editor.tsx'
import type { Decks, SaveResult } from '../src/wire/decks.ts'
import type { HeaderItemInput } from 'kehikot-module-protocol'

import type { Host } from '../src/wire/use-kehikot.ts'

/* The fakes the screen tests share: a host, an in-memory store, a textarea for CodeMirror. */

/**
 * The header as the page last declared it to its host, and where the page put what takes a press.
 * A new host starts both over. `press` is a press as the host relays one: an item's id, and the
 * option's id, the state wanted, or nothing.
 */
export const wire: { items: HeaderItemInput[]; declared: number; presses: Host['presses'] } = { items: [], declared: 0, presses: { current: null } }
export const item = <K extends HeaderItemInput['kind']>(id: string) => wire.items.find((one) => one.id === id) as Extract<HeaderItemInput, { kind: K }> | undefined
export const press = (id: string, value?: string | boolean) => {
  let said = 'no page takes presses' as string | boolean | void
  act(() => {
    said = wire.presses.current ? wire.presses.current({ item: id, ...(value === undefined ? {} : { value }) }) : said
  })
  return said
}

/** The following toggle as it is declared: its words while it is on, and whether it is. */
export const following = () => {
  const it = item<'toggle'>('following')
  const words = !it ? '' : it.checked ? it.label : 'Not following'
  return { textContent: words, getAttribute: (name: string) => (name === 'aria-pressed' ? String(it?.checked) : name === 'aria-label' ? words : null) }
}
export const toggleFollowing = () => press('following', !item<'toggle'>('following')!.checked)
/** Which pane a page too narrow for both has in front. */
export const pane = () => document.querySelector('[data-pane]')?.getAttribute('data-pane') ?? null

export function host(over: Partial<Host> = {}): Host {
  wire.items = []
  wire.declared = 0
  wire.presses = { current: null }
  return {
    header: (items) => {
      wire.items = items
      wire.declared += 1
    },
    presses: wire.presses,
    pressed: false,
    where: 'hosted',
    project: 'Thesis',
    projectPath: '/work/thesis',
    epic: 'write-chapter-two',
    theme: 'dark',
    passage: null,
    parts: [],
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
  const pointers = new Set<(state: PointerState) => void>()
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
    followPointer(project, slug, onPoint, presenting) {
      record('followPointer', project, slug, presenting)
      pointers.add(onPoint)
      onPoint({ slug, index: 0, at: 0 })
      return () => pointers.delete(onPoint)
    },
    async pointed(project, slug, at, did, hidden) {
      record('pointed', project, slug, at, did, hidden)
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
    /** The door saying the deck was pointed at a slide, to every page open on it. */
    point: (index: number, at: number) => act(() => pointers.forEach((listen) => listen({ slug: 'defence', index, at }))),
  }
}

/** CodeMirror stands in as a textarea: same props, and it reports the caret on select. */
export const jumps: number[] = []
/** Every jump the screen asked of the editor, with whether it asked for the keyboard too. */
export const jumped: { at: number; focus: boolean }[] = []
export function FakeEditor({ value, onChange, onCaret, jump }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!jump || !ref.current) return
    ref.current.selectionStart = jump.at
    jumps.push(jump.at)
    jumped.push({ at: jump.at, focus: jump.focus === true })
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
