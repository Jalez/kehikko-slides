import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { partsDeclaration, type EpicPart } from 'kehikot-module-protocol'

import { parseDeck } from '../deck/format.ts'
import { MANIFEST } from '../manifest.ts'
import { Screen } from '../src/app.tsx'
import { emptySaid, narrowDeck, nearestShown, positionSaid, stepShown } from '../src/focus.ts'
import { anchorsOf } from '../src/follow.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, caretAt, editor, fakeDecks, host, pause, preview, type } from './fakes.tsx'

/**
 * The parts focus in a deck: it NARROWS to the slides of the ticked parts, as
 * the paper narrows to their pages — the strip, the slide on screen, stepping
 * and the counter — and says nothing about it. The Markdown stays whole. The
 * rule is the protocol's; this is what anchors a slide and what the screen does.
 */

afterEach(cleanup)

const EPIC = 'write-chapter-two'
const PAPER = `.kehikot/paper/${EPIC}`
const PROJECT = '/work/thesis'

/* Five slides: a title in no part, one linked into the introduction, one that cites the methods (and is linked
   into the introduction), one linked into the methods, one linked to main.tex, which no part owns. */
const DECK = `---
title: Defence
---

# Title

---

<!-- section: ${PAPER}/chapters/intro.tex | Introduction -->
## Why

---

<!-- section: ${PAPER}/chapters/intro.tex | Aim -->
## How
- one[^1]
Sources:
[^1]: ${PAPER}/chapters/methods.tex | "the exact words"

---

<!-- section: ${PAPER}/chapters/methods.tex | Design -->
## Design

---

<!-- section: ${PAPER}/main.tex | Abstract -->
## In short
`

const parts = (...picked: string[]): EpicPart[] => [
  { id: 'intro', heading: 'Introduction', refs: [], picked: picked.includes('intro'), files: ['chapters/intro.tex'] },
  { id: 'methods', heading: 'Methods', refs: [], picked: picked.includes('methods'), files: ['chapters/methods.tex'] },
  { id: 'results', heading: 'Results', refs: [], picked: picked.includes('results'), files: ['chapters/results.tex'] },
]

const asked: { method: string; params: unknown }[] = []
const at = (fake: ReturnType<typeof fakeDecks>, picked: string[], over: Partial<Host> = {}) => (
  <Screen
    host={host({
      epic: EPIC,
      parts: parts(...picked),
      request: (method: string, params?: unknown) => {
        asked.push({ method, params })
        return Promise.resolve(null)
      },
      ...over,
    })}
    decks={fake.decks}
    editor={FakeEditor}
    saveDelay={20}
    publishDelay={5}
  />
)
const strip = () => within(screen.getByRole('navigation', { name: 'slides' })).queryAllByRole('button').map((thumb) => thumb.getAttribute('aria-label'))
const counter = () => preview().getByTestId('position').textContent
const onScreen = () => preview().queryByRole('heading')?.textContent ?? null
const turned = () => asked.filter((one) => one.method === 'passage.set').map((one) => (one.params as { passage: { section: { title: string } | null } }).passage.section?.title)
/** Nothing about the pick is written anywhere on the page. */
const silent = () => {
  expect(screen.queryByTestId('focus')).toBeNull()
  expect(document.body.textContent).not.toContain('outside the picked')
  expect(document.body.textContent).not.toContain('Parts are picked')
}

test('a slide is anchored to its section’s file and to every file it cites', () => {
  const slides = parseDeck(DECK, 'defence').slides
  expect(slides.map((slide) => anchorsOf(slide, PROJECT).map((anchor) => (anchor as { file: string }).file.replace(`${PROJECT}/${PAPER}/`, '')))).toEqual([
    [],
    ['chapters/intro.tex'],
    ['chapters/intro.tex', 'chapters/methods.tex'],
    ['chapters/methods.tex'],
    ['main.tex'],
  ])
})

describe('which slides a pick shows', () => {
  const slides = parseDeck(DECK, 'defence').slides
  const narrow = (picked: string[], held: number | null = null) => narrowDeck(parts(...picked), slides, PROJECT, EPIC, held)

  test('nothing ticked is the whole deck', () => {
    expect(narrow([])).toEqual({ focused: false, shown: [0, 1, 2, 3, 4], held: null })
    /* And holding a slide means nothing then. */
    expect(narrow([], 0).held).toBeNull()
  })

  test('a part is the slides linked into its files or citing them; a slide of no part is outside every pick', () => {
    expect(narrow(['methods']).shown).toEqual([2, 3])
    expect(narrow(['intro']).shown).toEqual([1, 2])
    expect(narrow(['intro', 'methods']).shown).toEqual([1, 2, 3])
    /* The title slide and the one linked to main.tex are in no part. */
    expect(narrow(['results']).shown).toEqual([])
  })

  test('the slide in hand is kept in its place in the order, and named', () => {
    expect(narrow(['methods'], 0)).toEqual({ focused: true, shown: [0, 2, 3], held: 0 })
    /* One that is in the pick anyway is not "held". */
    expect(narrow(['methods'], 3)).toEqual({ focused: true, shown: [2, 3], held: null })
  })

  test('the nearest shown slide, and the steps between shown slides', () => {
    expect(nearestShown([2, 3], 0)).toBe(2)
    expect(nearestShown([1, 2], 4)).toBe(2)
    /* As near on both sides: the one further on. */
    expect(nearestShown([1, 3], 2)).toBe(3)
    expect(nearestShown([], 2)).toBeNull()
    expect(stepShown([1, 3], 1, 1)).toBe(3)
    expect(stepShown([1, 3], 3, 1)).toBeNull()
    expect(stepShown([1, 3], 3, -1)).toBe(1)
    /* From a slide that is not itself shown. */
    expect(stepShown([1, 3], 2, 1)).toBe(3)
    expect(stepShown([1, 3], 2, -1)).toBe(1)
    expect(stepShown([1, 3], 0, -1)).toBeNull()
  })

  test('the counter: the whole deck as ever, and under a pick the place among the shown beside the deck’s own number', () => {
    expect(positionSaid(narrow([]), 2, 5)).toBe('3 / 5')
    expect(positionSaid(narrow(['methods']), 3, 5)).toBe('2 of 2 · slide 4 of 5')
    expect(positionSaid(narrow(['results']), null, 5)).toBe('0 of 0 · 5 in the deck')
  })

  test('the one sentence, for a pick that leaves no slide', () => {
    expect(emptySaid(parts('results'))).toBe('No slide of this deck is linked to or cites a file of the picked part.')
    expect(emptySaid(parts('results', 'intro'))).toBe('No slide of this deck is linked to or cites a file of the picked parts.')
  })
})

describe('the deck as the ticks change', () => {
  test('none → one → another → two → none: the strip, the slide on screen and the counter narrow; the Markdown never does', async () => {
    asked.length = 0
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    expect(counter()).toBe('1 / 5')
    expect(onScreen()).toBe('Title')
    silent()

    /* Methods: the title slide is in no part, so the deck moves to the nearest slide that is in the pick. */
    view.rerender(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 3', 'slide 4']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(counter()).toBe('1 of 2 · slide 3 of 5')
    expect(preview().getByRole('button', { name: 'previous slide' }).hasAttribute('disabled')).toBe(true)
    silent()
    expect(editor().value).toBe(DECK)

    /* Stepping stays inside the pick, and stops at its end. */
    fireEvent.click(preview().getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    expect(counter()).toBe('2 of 2 · slide 4 of 5')
    expect(preview().getByRole('button', { name: 'next slide' }).hasAttribute('disabled')).toBe(true)
    await pause(30)

    /* Another part instead: slide 4 is not in it, slide 3 is the nearest that is. */
    view.rerender(at(fake, ['intro']))
    await waitFor(() => expect(strip()).toEqual(['slide 2', 'slide 3']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(counter()).toBe('2 of 2 · slide 3 of 5')

    /* Two: the slide in front is still in the pick, so it stays. */
    view.rerender(at(fake, ['intro', 'methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 2', 'slide 3', 'slide 4']))
    expect(onScreen()).toBe('How')
    expect(counter()).toBe('2 of 3 · slide 3 of 5')

    /* None: the whole deck again, on the slide it was on. */
    view.rerender(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    expect(onScreen()).toBe('How')
    expect(counter()).toBe('3 / 5')
    silent()

    /* Through all of it nothing was written, and the text is the file's. */
    expect(editor().value).toBe(DECK)
    expect(fake.of('save')).toEqual([])
    await pause(40)
    /* The moves the ticks made were nobody stepping: the paper was not turned by them. The one step that was
       taken by hand, to a slide whose section is in the picked part, turned it. */
    expect(turned()).toEqual(['Design'])
  })

  test('a pick that leaves no slide: one sentence in the empty preview, and the Markdown still whole', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['results']))
    await waitFor(() => expect(preview().getByTestId('focus-empty').textContent).toBe('No slide of this deck is linked to or cites a file of the picked part.'))
    expect(strip()).toEqual([])
    expect(onScreen()).toBeNull()
    expect(counter()).toBe('0 of 0 · 5 in the deck')
    expect(editor().value).toBe(DECK)
    expect(screen.queryByTestId('focus')).toBeNull()
  })

  test('the caret put in a slide outside the pick, in the Markdown: that slide is in hand — drawn, set back in the strip, and gone when left', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 3', 'slide 4']))
    caretAt(DECK.indexOf('## Why'))
    await waitFor(() => expect(onScreen()).toBe('Why'))
    expect(strip()).toEqual(['slide 2', 'slide 3', 'slide 4'])
    const held = within(screen.getByRole('navigation', { name: 'slides' })).getByRole('button', { name: 'slide 2' })
    expect(held.hasAttribute('data-held')).toBe(true)
    expect(held.className).toContain('opacity-50')
    expect(counter()).toBe('1 of 3 · slide 2 of 5')
    silent()

    caretAt(DECK.indexOf('## Design'))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    expect(strip()).toEqual(['slide 3', 'slide 4'])
  })

  test('a slide with typing that is not saved is not taken away by a tick', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    caretAt(DECK.indexOf('## Why'))
    const typed = DECK.replace('## Why', '## Why now')
    type(typed)
    caretAt(typed.indexOf('## Why now'))
    view.rerender(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 2', 'slide 3', 'slide 4']))
    expect(onScreen()).toBe('Why now')
    expect(editor().value).toBe(typed)
    await waitFor(() => expect(fake.disk.text).toBe(typed))
  })

  test('stepping onto a slide shown for what it cites does not turn the paper to its section in another part’s file', async () => {
    asked.length = 0
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    fireEvent.click(preview().getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    await pause(30)
    /* Back to "How": linked to the introduction's "Aim", and the introduction is not picked. */
    fireEvent.click(preview().getByRole('button', { name: 'previous slide' }))
    await waitFor(() => expect(onScreen()).toBe('How'))
    await pause(30)
    expect(turned()).toEqual(['Design'])
  })

  test('presenting follows the pick: the keys step through the shown slides and stop at the last of them, with no notice', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    const stage = screen.getByTestId('stage')
    expect(stage.getAttribute('data-presenting')).not.toBeNull()
    expect(within(stage).getByRole('heading').textContent).toBe('How')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('Design'))
    /* The last of the part's slides: the deck's fifth is not gone on to. */
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await pause(20)
    expect(within(stage).getByRole('heading').textContent).toBe('Design')
    fireEvent.keyDown(window, { key: 'Home' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('How'))
    /* Nothing on the stage about the pick. */
    expect(stage.textContent).not.toContain('picked')
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  test('the paper on a section whose slide is outside the pick: not jumped to, and the following control says where it is', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const reading = { path: `${PROJECT}/${PAPER}/chapters/intro.tex`, page: 2, from: null, to: null, quoted: '', section: { title: 'Introduction', from: 0, to: 10 } }
    const view = render(at(fake, ['methods']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    view.rerender(at(fake, ['methods'], { passage: reading }))
    await waitFor(() => expect(screen.getByTestId('following').getAttribute('aria-label')).toBe('Slide 2, for Introduction, is outside the picked parts'))
    expect(onScreen()).toBe('How')
    expect(strip()).toEqual(['slide 3', 'slide 4'])
    /* With nothing picked the same reading is followed, as it always was. */
    view.rerender(at(fake, [], { passage: { ...reading, section: { title: 'Design', from: 0, to: 9 }, path: `${PROJECT}/${PAPER}/chapters/methods.tex` } }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
  })
})

test('the manifest says it follows the parts', () => {
  expect(MANIFEST.reacts).toContain('parts')
  expect(partsDeclaration(MANIFEST)).toEqual([])
})
