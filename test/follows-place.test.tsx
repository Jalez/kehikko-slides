import { afterEach, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { expectFollowsPlace } from 'kehikot-module-protocol/testing'

import { Screen } from '../src/app.tsx'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, fakeDecks, host, openDeck } from './fakes.tsx'

/**
 * The shared check for a module that follows the place (protocol 2.105.0): switching to a space with no deck
 * shows nothing of the deck before (its title, its slides), and switching back shows the deck again.
 * `places.test.tsx` holds the finer rules (which deck a place keeps).
 */

afterEach(cleanup)

const LIST = [{ slug: 'defence', title: 'Defence', epic: 'thesis', slides: 3, updated: 0 }]
const space = (...ids: string[]): Partial<Host> => ({ epic: ids[0] ?? null, space: { path: ids.map((id) => ({ id })), picked: [] } })

test('switching to a space with no deck shows nothing of the deck before', async () => {
  await expectFollowsPlace<Partial<Host>, { go: (place: Partial<Host>) => void }>({
    render: (place) => {
      const fake = fakeDecks({}, { list: LIST })
      const at = (over: Partial<Host>) => <Screen host={host(over)} decks={fake.decks} editor={FakeEditor} saveDelay={20} />
      const view = render(at(place))
      return { go: (next) => view.rerender(at(next)) }
    },
    switchTo: (shown, place) => act(async () => shown.go(place)),
    /* The open deck (its title in the header and its pane): the empty state also lists the decks one can open, so the page's text alone cannot tell. */
    text: () => `${openDeck() ?? ''} ${document.querySelector('[data-pane]') ? 'pane' : ''}`,
    filled: { place: space('thesis'), marker: 'Defence' },
    empty: space('thesis', 'chapter', 'section'),
  })
})
