import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'

import { Screen } from '../src/app.tsx'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, fakeDecks, host, item, openDeck, pane, press } from './fakes.tsx'

/**
 * What the container keeps (protocol 2.51.0): the place’s deck, the pane and following come back from
 * the host's kept value, and a press writes them back with `remember`, the other keys kept. The
 * stand-in behaves as the protocol's `useHost` does: `remember` updates `kept` for the next render.
 */

afterEach(cleanup)

const LIST = [
  { slug: 'defence', title: 'Defence', epic: 'write-chapter-two', slides: 3, updated: 0 },
  { slug: 'other', title: 'Another talk', epic: null, slides: 1, updated: 0 },
]

function keeping(start: unknown) {
  const base = host()
  const remembered: unknown[] = []
  function Kept({ fake }: { fake: ReturnType<typeof fakeDecks> }) {
    const [kept, setKept] = useState(start)
    const latest = useRef(kept)
    latest.current = kept
    const keeps: Host = {
      ...base,
      kept,
      read: () => ({ kept: latest.current }),
      remember: (next: never) => {
        remembered.push(next)
        latest.current = next
        setKept(next)
      },
    }
    return <Screen host={keeps} decks={fake.decks} editor={FakeEditor} saveDelay={20} />
  }
  return { Kept, remembered }
}

test('the place’s deck, the pane and following come back from what the host kept', async () => {
  const { Kept } = keeping({ deck: 'other', mode: 'preview', following: false })
  render(<Kept fake={fakeDecks({}, { list: LIST })} />)
  await waitFor(() => expect(openDeck()).toBe('Another talk'))
  await waitFor(() => expect(pane()).toBe('preview'))
  // The header is declared after the pane is drawn (a later effect, later still on a slow runner), so wait for it too.
  await waitFor(() => expect(item<'toggle'>('following')?.checked).toBe(false))
})

test('nothing kept: the open epic’s first deck, the editor, following', async () => {
  const { Kept } = keeping(null)
  render(<Kept fake={fakeDecks({}, { list: LIST })} />)
  await waitFor(() => expect(openDeck()).toBe('Defence'))
  await waitFor(() => expect(pane()).toBe('edit'))
  await waitFor(() => expect(item<'toggle'>('following')?.checked).toBe(true))
})

test('presses write the place’s deck, the pane and following back, keeping what else was kept', async () => {
  const { Kept, remembered } = keeping({ other: 1 })
  render(<Kept fake={fakeDecks({}, { list: LIST })} />)
  await waitFor(() => expect(openDeck()).toBe('Defence'))
  press('deck', 'd1')
  await waitFor(() => expect(openDeck()).toBe('Another talk'))
  await waitFor(() => expect(item('mode')).toBeDefined())
  press('mode', 'preview')
  press('following', false)
  await waitFor(() => expect(remembered.at(-1)).toEqual({ other: 1, places: { 'write-chapter-two': 'other' }, mode: 'preview', following: false }))
})
