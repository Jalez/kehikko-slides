import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

import { Screen } from '../src/app.tsx'
import { deckAt, homeOf, placeKey } from '../src/lib/places.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, fakeDecks, host, openDeck, pause, press } from './fakes.tsx'

afterEach(cleanup)

const LIST = [
  { slug: 'defence', title: 'Defence', epic: 'thesis', slides: 3, updated: 0 },
  { slug: 'other', title: 'Another talk', epic: null, slides: 1, updated: 0 },
]
const deck = (slug: string, epic: string | null) => ({ slug, title: slug, epic, slides: 1, updated: 0 })

describe('a place', () => {
  test('an older host and a host that says spaces name the same place', () => {
    const said = (...ids: string[]) => ({ epic: ids[0] ?? null, parts: [], space: { path: ids.map((id) => ({ id })), picked: [] } })
    expect(placeKey(said('a'))).toBe(placeKey({ epic: 'a', parts: [] }))
    expect(placeKey(said('a', 'p'))).toBe(placeKey({ epic: 'a', parts: ['p'] }))
    expect(placeKey({ epic: 'a', parts: ['q', 'p'] })).toBe(placeKey({ epic: 'a', parts: ['p', 'q'] }))
    expect(placeKey({ epic: 'a', parts: ['p', 'q'] })).toBe(placeKey({ epic: 'a', parts: [], space: { path: [{ id: 'a' }], picked: ['q', 'p'] } }))
    expect(placeKey({ epic: null, parts: [] })).toBe('project')
    expect(placeKey(said('a', 'b', 'c'))).not.toBe(placeKey(said('a', 'b')))
  })

  test('a top-level space and its parts share the epic’s decks; a deeper one has only its own', () => {
    const at = (...ids: string[]) => ({ epic: ids[0] ?? null, parts: [], space: { path: ids.map((id) => ({ id })) } })
    const list = [deck('x', 'a'), deck('y', 'b')]
    expect(deckAt(list, at('a'), {})).toBe('x')
    expect(deckAt(list, at('a', 'p'), {})).toBe('x')
    expect(deckAt(list, at('a', 'p', 'q'), {})).toBeNull()
    expect(deckAt(list, at('a', 'p', 'q'), { [placeKey(at('a', 'p', 'q'))]: 'y' })).toBe('y')
    expect(deckAt(list, at('c'), {})).toBeNull()
    expect(homeOf(at('a', 'p')).epic).toBe('a')
  })

  test('a kept deck that is gone is not shown', () => {
    expect(deckAt([deck('x', 'a')], { epic: 'a', parts: [] }, { a: 'gone' })).toBe('x')
    expect(deckAt([deck('x', 'b')], { epic: 'a', parts: [] }, { a: 'gone' })).toBeNull()
  })
})

describe('switching places', () => {
  /** The screen at a place, and a way for the host to say another. Same component, so what it keeps carries over. */
  function drawAt(first: Partial<Host>, list = LIST) {
    const fake = fakeDecks({}, { list })
    const at = (over: Partial<Host>) => <Screen host={host(over)} decks={fake.decks} editor={FakeEditor} saveDelay={20} />
    const view = render(at(first))
    return { fake, go: (over: Partial<Host>) => view.rerender(at(over)) }
  }
  const space = (...ids: string[]): Partial<Host> => ({ epic: ids[0] ?? null, space: { path: ids.map((id) => ({ id })), picked: [] } })
  const empty = () => screen.getByTestId('empty-place')

  test('a space with no deck shows the empty state and none of the deck before; back again restores it', async () => {
    const run = drawAt(space('thesis'))
    await waitFor(() => expect(openDeck()).toBe('Defence'))
    run.go(space('thesis', 'chapter', 'section'))
    await waitFor(() => expect(empty().textContent).toContain('No deck in this space yet'))
    expect(empty().textContent).toContain('create_deck')
    expect(openDeck()).toBeUndefined()
    expect(document.querySelector('[data-pane]')).toBeNull()
    run.go(space('thesis'))
    await waitFor(() => expect(openDeck()).toBe('Defence'))
    expect(screen.queryByTestId('empty-place')).toBeNull()
  })

  test('a deck opened from the empty state is that space’s, and is back with it', async () => {
    const run = drawAt(space('thesis', 'chapter', 'section'))
    await waitFor(() => expect(empty()).toBeDefined())
    screen.getByRole('button', { name: 'Another talk' }).click()
    await waitFor(() => expect(openDeck()).toBe('Another talk'))
    run.go(space('thesis'))
    await waitFor(() => expect(openDeck()).toBe('Defence'))
    run.go(space('thesis', 'chapter', 'section'))
    await waitFor(() => expect(openDeck()).toBe('Another talk'))
  })

  test('an older host, sending only the epic and its parts, gets the same', async () => {
    const part = (id: string, picked: boolean) => ({ id, heading: id, refs: [], picked })
    const run = drawAt({ epic: 'thesis' })
    await waitFor(() => expect(openDeck()).toBe('Defence'))
    run.go({ epic: 'elsewhere' })
    await waitFor(() => expect(empty().textContent).toContain('No deck in this space yet'))
    expect(openDeck()).toBeUndefined()
    run.go({ epic: 'thesis', parts: [part('intro', true)] as Host['parts'] })
    /* A part narrows the epic's deck; it is not a place with a deck of its own. */
    await waitFor(() => expect(openDeck()).toBe('Defence'))
    run.go({ epic: 'elsewhere' })
    await waitFor(() => expect(empty()).toBeDefined())
    run.go({ epic: 'thesis' })
    await waitFor(() => expect(openDeck()).toBe('Defence'))
  })

  test('the deck this container kept before places existed is the first place’s', async () => {
    const fake = fakeDecks({}, { list: LIST })
    const kept: Host = { ...host(space('thesis')), kept: { deck: 'other' }, read: () => ({ kept: { deck: 'other' } }), remember: () => {} }
    render(<Screen host={kept} decks={fake.decks} editor={FakeEditor} saveDelay={20} />)
    await waitFor(() => expect(openDeck()).toBe('Another talk'))
    await pause(10)
    expect(press('history')).toBeTruthy()
  })
})
