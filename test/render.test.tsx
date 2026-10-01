import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'

import type { DeckSummary, HistoryEntry, Version, WatchEvent } from '../deck/api.ts'
import { Screen, byEpic } from '../src/app.tsx'
import type { EditorProps } from '../src/editor/deck-editor.tsx'
import type { Decks, SaveResult } from '../src/wire/decks.ts'
import type { Host } from '../src/wire/use-roadmap.ts'

afterEach(cleanup)

function host(over: Partial<Host> = {}): Host {
  return {
    where: 'hosted',
    project: 'Thesis',
    projectPath: '/work/thesis',
    epic: 'write-chapter-two',
    theme: 'dark',
    request: () => Promise.resolve(null),
    ...over,
  }
}

const DECK = `---
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
function fakeDecks(
  over: Partial<Decks> = {},
  start: { list?: DeckSummary[]; text?: string; version?: Version; history?: HistoryEntry[] } = {},
) {
  const calls: Call[] = []
  const listeners: ((event: WatchEvent) => void)[] = []
  const disk = { text: start.text ?? DECK, version: (start.version ?? 1) as Version }
  let list: DeckSummary[] = start.list ?? [
    { slug: 'defence', title: 'Defence', epic: 'write-chapter-two', slides: 3, updated: '' },
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
      disk.version = Number(disk.version) + 1
      return { ok: true, version: disk.version }
    },
    async create(project, title, epic) {
      record('create', project, title, epic)
      const slug = title.toLowerCase().replace(/\W+/g, '-')
      list = [...list, { slug, title, epic: epic ?? null, slides: 1, updated: '' }]
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
    ...over,
  }
  return {
    decks,
    calls,
    disk,
    of: (method: string) => calls.filter((call) => call.method === method),
    emit: (event: WatchEvent) => act(() => listeners.forEach((listen) => listen(event))),
  }
}

/** CodeMirror stands in as a textarea: same props, and it reports the caret on select. */
const jumps: number[] = []
function FakeEditor({ value, onChange, onCaret, jump }: EditorProps) {
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

const draw = (fake: ReturnType<typeof fakeDecks>, over: Partial<Host> = {}, saveDelay = 20) =>
  render(<Screen host={host(over)} decks={fake.decks} editor={FakeEditor} saveDelay={saveDelay} />)

const editor = () => screen.getByLabelText('deck markdown') as HTMLTextAreaElement
const preview = () => within(screen.getByRole('region', { name: 'preview' }))
const caretAt = (at: number) => {
  editor().setSelectionRange(at, at)
  fireEvent.select(editor())
}
const type = (text: string) => fireEvent.change(editor(), { target: { value: text } })
const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

describe('empty states', () => {
  test('with no project it says so and asks the store nothing', () => {
    const fake = fakeDecks()
    draw(fake, { projectPath: null, project: null })
    expect(screen.getByText(/Open a project/)).toBeDefined()
    expect(fake.calls).toEqual([])
  })

  test('with no decks it offers to make the first, in the open epic', async () => {
    const fake = fakeDecks({}, { list: [] })
    draw(fake)
    fireEvent.change(await screen.findByLabelText('deck title'), { target: { value: 'Defence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }))
    await waitFor(() => expect(fake.of('create')[0]?.args).toEqual(['/work/thesis', 'Defence', 'write-chapter-two']))
    await waitFor(() => expect(editor().value).toBe(DECK))
  })

  test('says it is loading until the list arrives', () => {
    const fake = fakeDecks({ list: () => new Promise(() => {}) })
    draw(fake)
    expect(screen.getByText(/Loading decks/)).toBeDefined()
  })
})

describe('the deck switcher', () => {
  test('orders the open epic first, then the rest', () => {
    const one = (slug: string, epic: string | null) => ({ slug, title: slug, epic, slides: 1, updated: '' })
    const ordered = byEpic([one('b', null), one('z', 'mine'), one('a', 'other'), one('m', 'mine')], 'mine')
    expect(ordered.map((deck) => deck.slug)).toEqual(['m', 'z', 'a', 'b'])
  })

  test('shows the open deck, and renames and removes through the store', async () => {
    const fake = fakeDecks(
      {},
      {
        list: [
          { slug: 'defence', title: 'Defence', epic: 'write-chapter-two', slides: 3, updated: '' },
          { slug: 'other', title: 'Another talk', epic: null, slides: 1, updated: '' },
        ],
      },
    )
    draw(fake)
    const trigger = await screen.findByRole('button', { name: /Defence/ })
    expect(trigger).toBeDefined()

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    const rows = await screen.findAllByRole('menuitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Defence', 'Another talk', 'new deck…'])

    fireEvent.click(screen.getByLabelText('rename Another talk'))
    const field = await screen.findByLabelText('deck name')
    fireEvent.change(field, { target: { value: 'Seminar' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(fake.of('retitle')[0]?.args).toEqual(['/work/thesis', 'other', 'Seminar']))

    fireEvent.click(await screen.findByLabelText('remove Seminar'))
    fireEvent.click(screen.getByText('remove it?'))
    await waitFor(() => expect(fake.of('remove')[0]?.args).toEqual(['/work/thesis', 'other']))
  })
})

describe('the workspace', () => {
  test('the caret drives the preview, and thumbnails move the caret', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))

    expect(preview().getByRole('heading').textContent).toBe('Bridging the gap')
    expect(preview().getByTestId('position').textContent).toBe('1 / 3')

    caretAt(DECK.indexOf('- two'))
    expect(preview().getByRole('heading').textContent).toBe('The problem')
    expect(preview().queryByText(/Never shown/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'slide 3' }))
    expect(preview().getByRole('heading').textContent).toBe('The answer')
    expect(jumps.at(-1)).toBe(DECK.indexOf('## The answer'))
    expect(screen.getByRole('button', { name: 'slide 3' }).getAttribute('aria-current')).toBe('true')
  })

  test('thumbnails follow the text as it is typed', async () => {
    const fake = fakeDecks()
    draw(fake, {}, 10_000)
    await waitFor(() => expect(editor().value).toBe(DECK))
    expect(screen.getAllByRole('button', { name: /^slide \d$/ })).toHaveLength(3)
    type(`${DECK}\n---\n\n## Four\n`)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^slide \d$/ })).toHaveLength(4))
  })

  test('an edit is saved after a pause, with the version it was made from', async () => {
    const fake = fakeDecks({}, { version: 7 })
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    type(`${DECK}more`)
    type(`${DECK}more words`)
    expect(fake.of('save')).toHaveLength(0)
    await waitFor(() => expect(fake.of('save')).toHaveLength(1))
    expect(fake.of('save')[0]?.args).toEqual(['/work/thesis', 'defence', `${DECK}more words`, 7])
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))

    type(`${DECK}more words again`)
    await waitFor(() => expect(fake.of('save')).toHaveLength(2))
    expect(fake.of('save')[1]?.args[3]).toBe(8)
  })

  test('a refused save raises a notice; keep mine overwrites at the newer version', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    fake.disk.version = 5
    fake.disk.text = 'theirs'
    type('mine')
    await screen.findByText(/changed elsewhere/)
    expect(screen.getByTestId('save-state').textContent).toBe('not saved')

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(fake.disk.text).toBe('mine'))
    expect(fake.of('save').at(-1)?.args[3]).toBe(5)
    expect(screen.queryByText(/changed elsewhere/)).toBeNull()
  })

  test('a change on disk reloads the deck when nothing is unsaved', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    fake.disk.text = '## Rewritten by an agent'
    fake.disk.version = 2
    fake.emit({ slug: 'defence', version: 2 })
    await waitFor(() => expect(editor().value).toBe('## Rewritten by an agent'))
  })

  test('a change on disk does not reload over unsaved edits; it says so instead', async () => {
    const fake = fakeDecks()
    draw(fake, {}, 10_000)
    await waitFor(() => expect(editor().value).toBe(DECK))
    type('my unsaved words')
    const reads = fake.of('read').length
    fake.disk.text = 'agent text'
    fake.disk.version = 2
    fake.emit({ slug: 'defence', version: 2 })
    await screen.findByText(/changed on disk/)
    expect(editor().value).toBe('my unsaved words')
    expect(fake.of('read')).toHaveLength(reads)

    fireEvent.click(screen.getByRole('button', { name: 'Reload theirs' }))
    await waitFor(() => expect(editor().value).toBe('agent text'))
  })

  test('the echo of our own save does not reload', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    type('saved by me')
    await waitFor(() => expect(fake.of('save')).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
    const reads = fake.of('read').length
    fake.emit({ slug: 'defence', version: 2 })
    await pause(10)
    expect(fake.of('read')).toHaveLength(reads)
  })
})

describe('history', () => {
  test('lists agent edits and undoes one', async () => {
    const fake = fakeDecks(
      {},
      { history: [{ id: 'h1', slug: 'defence', at: '2026-10-01T10:00:00Z', agent: 'claude', summary: 'add results slide' }] },
    )
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(await screen.findByText('add results slide')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'undo add results slide' }))
    await waitFor(() => expect(fake.of('undo')[0]?.args).toEqual(['/work/thesis', 'defence', 'h1']))
  })
})

describe('slots for the next step', () => {
  test('present, PDF and following render in the header', async () => {
    const fake = fakeDecks()
    render(
      <Screen
        host={host()}
        decks={fake.decks}
        editor={FakeEditor}
        slots={{ present: <button>Present</button>, exportPdf: <button>PDF</button>, following: <span>following</span> }}
      />,
    )
    await waitFor(() => expect(editor().value).toBe(DECK))
    expect(screen.getByRole('button', { name: 'Present' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDefined()
    expect(screen.getByText('following')).toBeDefined()
  })
})
