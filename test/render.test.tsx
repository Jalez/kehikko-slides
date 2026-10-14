import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Screen, byEpic } from '../src/app.tsx'
import { DECK, FakeEditor, caretAt, draw, editor, fakeDecks, following, host, item, jumps, pause, press, preview, type, wire } from './fakes.tsx'

afterEach(cleanup)


describe('empty states', () => {
  test('with no project it says so and asks the store nothing', () => {
    const fake = fakeDecks()
    draw(fake, { projectPath: null, project: null })
    expect(screen.getByText(/No project is open/)).toBeDefined()
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
    expect(document.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe('loading')
  })

  test('before a host has greeted the page it is waiting, not "no project"; then unhosted, or no project', () => {
    const none = { project: null, projectPath: null, epic: null }
    for (const [where, state] of [['listening', 'waiting'], ['unhosted', 'unhosted'], ['hosted', 'no-project']] as const) {
      const { unmount } = draw(fakeDecks(), { ...none, where })
      expect(document.querySelector('[data-cover]')?.getAttribute('data-cover')).toBe(state)
      unmount()
    }
  })
})

describe('the deck switcher', () => {
  test('orders the open epic first, then the rest', () => {
    const one = (slug: string, epic: string | null) => ({ slug, title: slug, epic, slides: 1, updated: 0 })
    const ordered = byEpic([one('b', null), one('z', 'mine'), one('a', 'other'), one('m', 'mine')], 'mine')
    expect(ordered.map((deck) => deck.slug)).toEqual(['m', 'z', 'a', 'b'])
  })

  test('the decks are a Go item naming the open one; a new name is asked in a dialog, and removing takes a second press', async () => {
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
    await waitFor(() => expect(item<'go'>('deck')?.label).toBe('Decks · Defence'))
    expect(item<'go'>('deck')!.options.map((one) => one.label)).toEqual(['Defence', 'Another talk'])
    /* No strip of its own: no switcher button, no header row. */
    expect(document.querySelector('header')).toBeNull()
    expect(screen.queryByRole('button', { name: /Defence/ })).toBeNull()

    press('deck', 'd1')
    await waitFor(() => expect(item<'go'>('deck')?.label).toBe('Decks · Another talk'))
    press('deck-rename')
    const field = await screen.findByLabelText('deck name')
    expect((field as HTMLInputElement).value).toBe('Another talk')
    fireEvent.change(field, { target: { value: 'Seminar' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(fake.of('retitle')[0]?.args).toEqual(['/work/thesis', 'other', 'Seminar']))
    await waitFor(() => expect(item<'run'>('deck-remove')?.label).toBe('Remove “Seminar”'))

    /* The second press is the host's to ask for (`confirm`), so no agent can make it; the page does it when told. */
    expect(item<'run'>('deck-remove')).toMatchObject({ confirm: true })
    expect(item<'run'>('deck-remove')!.agents).toBeUndefined()
    press('deck-remove')
    await waitFor(() => expect(fake.of('remove')[0]?.args).toEqual(['/work/thesis', 'other']))

    press('deck-new')
    fireEvent.change(await screen.findByLabelText('deck name'), { target: { value: 'Viva' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(fake.of('create')[0]?.args).toEqual(['/work/thesis', 'Viva', 'write-chapter-two']))
  })

  test('F2 asks for a new name for the open deck, from anywhere in the page', async () => {
    draw(fakeDecks())
    await waitFor(() => expect(editor().value).toBe(DECK))
    expect(item<'run'>('deck-rename')!.shortcut).toBe('F2')
    fireEvent.keyDown(window, { key: 'F2' })
    expect(((await screen.findByLabelText('deck name')) as HTMLInputElement).value).toBe('Defence')
  })
})

describe('following the epic', () => {
  const list = [
    { slug: 'catalog', title: 'Catalog', epic: 'catalog', slides: 3, updated: 0 },
    { slug: 'catalog-b', title: 'Catalog, the long one', epic: 'catalog', slides: 3, updated: 0 },
    { slug: 'durable', title: 'Durable writes', epic: 'durable-writes', slides: 3, updated: 0 },
  ]
  /** The screen on one epic, and a way for the host to say another. */
  function drawOn(epic: string | null) {
    const fake = fakeDecks({}, { list })
    const at = (epic: string | null) => <Screen host={host({ epic })} decks={fake.decks} editor={FakeEditor} saveDelay={20} />
    const view = render(at(epic))
    return { fake, turn: (epic: string | null) => view.rerender(at(epic)) }
  }
  /** The deck that is open, as the Go item names it. */
  const open = () => item<'go'>('deck')?.label.replace(/^Decks · /, '')
  const shown = (name: string) => waitFor(() => expect(open()).toBe(name))
  const pick = async (name: string) => {
    const deck = item<'go'>('deck')!
    press('deck', deck.options.find((one) => one.label === name)!.id)
  }

  test('a new epic opens its first deck', async () => {
    const run = drawOn('catalog')
    await shown('Catalog')
    run.turn('durable-writes')
    await shown('Durable writes')
    await waitFor(() => expect(run.fake.of('read').at(-1)?.args).toEqual(['/work/thesis', 'durable']))
    run.turn('catalog')
    await shown('Catalog')
  })

  test('an epic with no deck leaves the open deck where it is', async () => {
    const run = drawOn('durable-writes')
    await shown('Durable writes')
    run.turn('nothing-here')
    await pause(10)
    expect(open()).toBe('Durable writes')
    run.turn(null)
    await pause(10)
    expect(open()).toBe('Durable writes')
  })

  test('a deck picked by hand stays open until the epic changes again', async () => {
    const run = drawOn('catalog')
    await shown('Catalog')
    await pick('Durable writes')
    await shown('Durable writes')

    /* The host says the same epic again (any context does): that is not a change. */
    run.turn('catalog')
    await pause(10)
    expect(open()).toBe('Durable writes')

    run.turn('durable-writes')
    await pick('Catalog, the long one')
    await shown('Catalog, the long one')
    run.turn('catalog')
    await shown('Catalog')
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
    press('history')
    expect(await screen.findByText('add results slide')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'undo add results slide' }))
    await waitFor(() => expect(fake.of('undo')[0]?.args).toEqual(['/work/thesis', 'defence', 'h1']))
  })
})

describe('the header the host draws', () => {
  test('there is no row of controls in the page: every one is declared, in the menu its kind names', async () => {
    draw(fakeDecks())
    await waitFor(() => expect(item<'go'>('slide')?.label).toBe('Slide 1 of 3'))
    await waitFor(() => expect(following().getAttribute('aria-label')).toBe('Following the paper'))
    expect(wire.items.map((one) => `${one.kind} ${one.id}`)).toEqual([
      'switch mode',
      'toggle following',
      'go deck',
      'go slide',
      'run present',
      'run presenter',
      'run export',
      'run history',
      'run deck-new',
      'run deck-rename',
      'run deck-remove',
    ])
    expect(document.querySelector('header')).toBeNull()
    expect(document.querySelector('[role="tablist"]')).toBeNull()
    for (const name of ['Present', 'Presenter view', 'Export PDF', 'History', 'More actions']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(item<'switch'>('mode')).toMatchObject({ value: 'edit', options: [{ id: 'edit', label: 'Edit' }, { id: 'preview', label: 'Preview' }] })
    expect(following().getAttribute('aria-label')).toBe('Following the paper')
    /* An agent turns the page with the door's tool, and is sent there; nothing here is an agent's to press. */
    expect(item<'go'>('slide')).toMatchObject({ tool: 'show_slide', label: 'Slide 1 of 3' })
    expect(item<'go'>('slide')!.options).toEqual([
      { id: 's0', label: '1. Bridging the gap' },
      { id: 's1', label: '2. The problem' },
      { id: 's2', label: '3. The answer' },
    ])
    expect(wire.items.some((one) => one.agents)).toBe(false)
  })

  test('a press does what the control did, and the header says the new state', async () => {
    const fake = fakeDecks(
      {},
      { history: [{ id: 'h1', slug: 'defence', at: '2026-10-01T10:00:00Z', agent: 'claude', summary: 'add results slide' }] },
    )
    draw(fake)
    await waitFor(() => expect(item('present')).toBeDefined())
    expect(press('mode', 'preview')).toBe(true)
    await waitFor(() => expect(item<'switch'>('mode')!.value).toBe('preview'))
    press('slide', 's2')
    await waitFor(() => expect(item<'go'>('slide')!.label).toBe('Slide 3 of 3'))
    expect(preview().getByRole('heading').textContent).toBe('The answer')
    expect(press('slide', 's9')).toBe('That slide is not among the slides shown now.')
    /* The state wanted, not "flip": said twice, it changes nothing. */
    press('following', false)
    press('following', false)
    await waitFor(() => expect(item<'toggle'>('following')).toMatchObject({ checked: false, label: 'Follow the paper' }))
    press('history')
    expect(await screen.findByText('add results slide')).toBeDefined()
    expect(press('nonsense')).toBe('That is not something these slides have.')
  })

  test('typing declares nothing; a headline that changed is said once, when it is saved', async () => {
    draw(fakeDecks(), {}, 40)
    await waitFor(() => expect(item('present')).toBeDefined())
    await pause(60)
    const before = wire.declared
    let text = editor().value
    for (const key of 'fourteen keys.') {
      text = text.replace('- one', `- one${key}`)
      type(text)
    }
    expect(wire.declared).toBe(before)
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
    await pause(30)
    expect(wire.declared).toBe(before)
    let headline = '## The problem'
    for (const key of 'now') {
      text = text.replace(headline, headline + key)
      headline += key
      type(text)
    }
    expect(wire.declared).toBe(before)
    await waitFor(() => expect(item<'go'>('slide')!.options[1]!.label).toBe('2. The problemnow'))
    expect(wire.declared).toBe(before + 1)
  })

  test('whether it is saved is a dot with the word as its name, and the word where there is room', async () => {
    draw(fakeDecks())
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('saved'))
    expect(screen.getByRole('img', { name: 'saved' })).toBeDefined()
  })

  test('the page’s own menu is there until a host has pressed, with the same items behind it', async () => {
    const fake = fakeDecks()
    const view = draw(fake)
    await waitFor(() => expect(item('present')).toBeDefined())
    const menu = screen.getByTestId('header-menu')
    fireEvent.keyDown(menu, { key: 'Enter' })
    const follow = await screen.findByRole('menuitemcheckbox', { name: 'Following the paper' })
    expect(follow.getAttribute('aria-checked')).toBe('true')
    for (const name of ['Present', 'Presenter view', 'Export PDF', 'History', 'New deck…']) expect(screen.getByRole('menuitem', { name })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Preview' }))
    await waitFor(() => expect(item<'switch'>('mode')!.value).toBe('preview'))
    view.unmount()
    render(<Screen host={host({ pressed: true })} decks={fake.decks} editor={FakeEditor} saveDelay={20} />)
    await waitFor(() => expect(item('present')).toBeDefined())
    expect(screen.queryByTestId('header-menu')).toBeNull()
  })

  test('the page’s own menu follows what the host says it draws: true never, false always, nothing until a press', async () => {
    const fake = fakeDecks()
    for (const [drawsHeader, pressed, shown] of [
      [true, false, false],
      [true, true, false],
      [false, false, true],
      [false, true, true],
      [null, false, true],
      [null, true, false],
    ] as const) {
      const view = render(<Screen host={host({ drawsHeader, pressed })} decks={fake.decks} editor={FakeEditor} saveDelay={20} />)
      await waitFor(() => expect(item('present')).toBeDefined())
      expect(screen.queryByTestId('header-menu') !== null).toBe(shown)
      view.unmount()
    }
  })

  test('Present declares surface: fullscreen to a host that says it draws the header, and to no other', async () => {
    const fake = fakeDecks()
    for (const [drawsHeader, surface] of [[true, 'fullscreen'], [false, undefined], [null, undefined]] as const) {
      const view = render(<Screen host={host({ drawsHeader })} decks={fake.decks} editor={FakeEditor} saveDelay={20} />)
      await waitFor(() => expect(item('present')).toBeDefined())
      expect((item('present') as { surface?: string }).surface).toBe(surface)
      view.unmount()
    }
  })
})
