import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

import { partsDeclaration, type EpicPart } from 'kehikot-module-protocol'

import { parseDeck } from '../deck/format.ts'
import { MANIFEST } from '../manifest.ts'
import { Screen } from '../src/app.tsx'
import { anchorsOf } from '../src/follow.ts'
import { FakeEditor, caretAt, editor, fakeDecks, host, preview } from './fakes.tsx'

/**
 * The parts focus in a deck: the slides outside the ticked parts are set back
 * in the list and counted, and nothing is taken out of the deck. The rule is
 * the protocol's; this is what anchors a slide and what the screen does.
 */

afterEach(cleanup)

const EPIC = 'write-chapter-two'
const PAPER = `.kehikot/paper/${EPIC}`

const DECK = `---
title: Defence
---

# Title

---

<!-- section: ${PAPER}/chapters/intro.tex | Introduction -->
## Why

---

## How
- one[^1]
Sources:
[^1]: ${PAPER}/chapters/methods.tex | "the exact words"

---

<!-- section: ${PAPER}/main.tex | Abstract -->
## In short
`

const parts = (...picked: string[]): EpicPart[] => [
  { id: 'intro', heading: 'Introduction', refs: [], picked: picked.includes('intro'), files: ['chapters/intro.tex'] },
  { id: 'methods', heading: 'Methods', refs: [], picked: picked.includes('methods'), files: ['chapters/methods.tex'] },
]

const at = (fake: ReturnType<typeof fakeDecks>, picked: string[]) => (
  <Screen host={host({ epic: EPIC, parts: parts(...picked) })} decks={fake.decks} editor={FakeEditor} saveDelay={20} />
)
const thumbs = () => within(screen.getByRole('navigation', { name: 'slides' })).getAllByRole('button')
const setBack = () => thumbs().map((thumb) => thumb.hasAttribute('data-outside'))

test('a slide is anchored to its section’s file and to every file it cites', () => {
  const slides = parseDeck(DECK, 'defence').slides
  expect(slides.map((slide) => anchorsOf(slide, '/work/thesis'))).toEqual([
    [],
    [{ file: `/work/thesis/${PAPER}/chapters/intro.tex` }],
    [{ file: `/work/thesis/${PAPER}/chapters/methods.tex` }],
    [{ file: `/work/thesis/${PAPER}/main.tex` }],
  ])
})

describe('the deck under a focus', () => {
  test('nothing ticked: no line, nothing set back', async () => {
    render(at(fakeDecks({}, { text: DECK }), []))
    await waitFor(() => expect(thumbs()).toHaveLength(4))
    expect(screen.queryByTestId('focus')).toBeNull()
    expect(setBack()).toEqual([false, false, false, false])
  })

  test('one part ticked: its slides stand, the rest are set back and counted — none is removed', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, ['methods']))
    await waitFor(() => expect(thumbs()).toHaveLength(4))
    expect(setBack()).toEqual([true, true, false, true])
    expect(screen.getByTestId('focus').textContent).toBe(
      '3 slides outside the picked part (Methods). Set back in the list, not removed; the slide on screen is one of them.',
    )
    expect(editor().value).toBe(DECK)
    expect(preview().getByTestId('position').textContent).toBe('1 / 4')

    view.rerender(at(fake, ['methods', 'intro']))
    expect(setBack()).toEqual([true, false, false, true])
    expect(screen.getByTestId('focus').textContent).toStartWith('2 slides outside the 2 picked parts (Introduction, Methods).')
  })

  test('a tick does not move the slide on screen, and the text is not touched', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, []))
    await waitFor(() => expect(thumbs()).toHaveLength(4))
    caretAt(DECK.indexOf('## Why'))
    expect(preview().getByTestId('position').textContent).toBe('2 / 4')
    view.rerender(at(fake, ['methods']))
    expect(preview().getByTestId('position').textContent).toBe('2 / 4')
    expect(preview().getByText('Why')).toBeDefined()
    expect(thumbs()[1]!.getAttribute('aria-current')).toBe('true')
    expect(editor().value).toBe(DECK)
    expect(fake.of('save')).toEqual([])

    caretAt(DECK.indexOf('## How'))
    expect(screen.getByTestId('focus').textContent).toBe('3 slides outside the picked part (Methods). Set back in the list, not removed.')
  })
})

test('the manifest says it follows the parts', () => {
  expect(MANIFEST.reacts).toContain('parts')
  expect(partsDeclaration(MANIFEST)).toEqual([])
})
