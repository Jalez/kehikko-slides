import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { byEpic } from '../src/app.tsx'
import { DECK, caretAt, draw, editor, fakeDecks, jumps, pause, preview, type } from './fakes.tsx'

afterEach(cleanup)


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
    const one = (slug: string, epic: string | null) => ({ slug, title: slug, epic, slides: 1, updated: 0 })
    const ordered = byEpic([one('b', null), one('z', 'mine'), one('a', 'other'), one('m', 'mine')], 'mine')
    expect(ordered.map((deck) => deck.slug)).toEqual(['m', 'z', 'a', 'b'])
  })

  test('shows the open deck, and renames and removes through the store', async () => {
    const fake = fakeDecks(
      {},
      {
        list: [
          { slug: 'defence', title: 'Defence', epic: 'write-chapter-two', slides: 3, updated: 0 },
          { slug: 'other', title: 'Another talk', epic: null, slides: 1, updated: 0 },
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

    /* The panes draw from a deferred copy of the text, so they may land a render after the editor. */
    await waitFor(() => expect(preview().getByRole('heading').textContent).toBe('Bridging the gap'))
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
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^slide \d$/ })).toHaveLength(3))
    type(`${DECK}\n---\n\n## Four\n`)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^slide \d$/ })).toHaveLength(4))
  })

  test('an edit is saved after a pause, with the version it was made from', async () => {
    const fake = fakeDecks({}, { version: 'v7' })
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    type(`${DECK}more`)
    type(`${DECK}more words`)
    expect(fake.of('save')).toHaveLength(0)
    await waitFor(() => expect(fake.of('save')).toHaveLength(1))
    expect(fake.of('save')[0]?.args).toEqual(['/work/thesis', 'defence', `${DECK}more words`, 'v7'])
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))

    type(`${DECK}more words again`)
    await waitFor(() => expect(fake.of('save')).toHaveLength(2))
    expect(fake.of('save')[1]?.args[3]).toBe('v8')
  })

  test('a refused save raises a notice; keep mine overwrites at the newer version', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    fake.disk.version = 'v5'
    fake.disk.text = 'theirs'
    type('mine')
    await screen.findByText(/changed elsewhere/)
    expect(screen.getByTestId('save-state').textContent).toBe('not saved')

    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    await waitFor(() => expect(fake.disk.text).toBe('mine'))
    expect(fake.of('save').at(-1)?.args[3]).toBe('v5')
    expect(screen.queryByText(/changed elsewhere/)).toBeNull()
  })

  test('a change on disk reloads the deck when nothing is unsaved', async () => {
    const fake = fakeDecks()
    draw(fake)
    await waitFor(() => expect(editor().value).toBe(DECK))
    fake.disk.text = '## Rewritten by an agent'
    fake.disk.version = 'v2'
    fake.emit({ slug: 'defence', version: 'v2' })
    await waitFor(() => expect(editor().value).toBe('## Rewritten by an agent'))
  })

  test('a change on disk does not reload over unsaved edits; it says so instead', async () => {
    const fake = fakeDecks()
    draw(fake, {}, 10_000)
    await waitFor(() => expect(editor().value).toBe(DECK))
    type('my unsaved words')
    const reads = fake.of('read').length
    fake.disk.text = 'agent text'
    fake.disk.version = 'v2'
    fake.emit({ slug: 'defence', version: 'v2' })
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
    fake.emit({ slug: 'defence', version: 'v2' })
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
