import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'

import { partsDeclaration, type EpicPart } from 'kehikot-module-protocol'
import { useFocus } from 'kehikot-module-protocol/client/react'

import { parseDeck } from '../deck/format.ts'
import { MANIFEST } from '../manifest.ts'
import { Screen } from '../src/app.tsx'
import { anchorsIn, narrowDeck, nearestShown, positionSaid, stepShown } from '../src/focus.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, caretAt, editor, fakeDecks, host, jumped, pause, preview, type } from './fakes.tsx'

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

/* Five slides: a title tied to nothing, one linked into the introduction, one that cites the methods (and is linked
   into the introduction), one linked into the methods, and a closing one linked to main.tex, which no part has. */
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

/* A deck that opens and closes inside a part, with two slides between them that no part has: one tied to nothing,
   one linked to main.tex. */
const TIED = `---
title: One chapter
---

<!-- section: ${PAPER}/chapters/intro.tex | Introduction -->
## Why

---

## An aside

---

<!-- section: ${PAPER}/main.tex | Abstract -->
## In short

---

<!-- section: ${PAPER}/chapters/methods.tex | Design -->
## Design
`

/**
 * The two ways a host says what a part has: only `files`, relative to the
 * paper's folder (before protocol 1.2.0; app 0.1.16), or `documents`,
 * relative to the project, with `files` still filled beside them (0.1.17).
 */
type Shape = 'files' | 'documents'
const has = (file: string, shape: Shape) => (shape === 'files' ? { files: [file] } : { documents: [`${PAPER}/${file}`], files: [file] })
const partsAs = (shape: Shape, ...picked: string[]): EpicPart[] => [
  { id: 'intro', heading: 'Introduction', refs: [], picked: picked.includes('intro'), ...has('chapters/intro.tex', shape) },
  { id: 'methods', heading: 'Methods', refs: [], picked: picked.includes('methods'), ...has('chapters/methods.tex', shape) },
  { id: 'results', heading: 'Results', refs: [], picked: picked.includes('results'), ...has('chapters/results.tex', shape) },
]
const parts = (...picked: string[]) => partsAs('files', ...picked)
/** The protocol's rule over these parts, as the page holds it. */
const focusOn = (list: readonly EpicPart[]) => renderHook(() => useFocus({ parts: list, epic: EPIC, projectPath: PROJECT })).result.current

const asked: { method: string; params: unknown }[] = []
const at = (fake: ReturnType<typeof fakeDecks>, picked: string[], over: Partial<Host> = {}) => (
  <Screen
    host={host({
      epic: EPIC,
      projectPath: PROJECT,
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
/** Nothing about the pick is written anywhere on the page: no line, no label, no hint on a slide. */
const silent = () => {
  expect(screen.queryByTestId('focus')).toBeNull()
  expect(document.body.textContent).not.toContain('outside the picked')
  expect(document.body.textContent).not.toContain('Parts are picked')
  expect(document.body.textContent).not.toContain('picked part')
  expect([...document.querySelectorAll('[title]')].map((one) => one.getAttribute('title')).filter((title) => /picked|outside/i.test(title ?? ''))).toEqual([])
}

test('a slide is anchored by its source — its section’s file and every file it cites — and the title and closing slides, tied to no part, by the whole', () => {
  const slides = parseDeck(DECK, 'defence').slides
  const anchors = anchorsIn(focusOn(parts()), slides, PROJECT, EPIC)
  const short = (index: number) => anchors(index).map((anchor) => ('file' in anchor ? anchor.file.replace(`${PROJECT}/${PAPER}/`, '') : anchor))
  expect(slides.map((_, index) => short(index))).toEqual([
    /* The title: linked to nothing, cites nothing. */
    [{ whole: true }],
    ['chapters/intro.tex'],
    ['chapters/intro.tex', 'chapters/methods.tex'],
    ['chapters/methods.tex'],
    /* The closing slide: linked only to a file no part of the epic has. */
    [{ whole: true }],
  ])
})

test('a first or last slide that IS tied to a part is by its source; a slide in between tied to none answers no part', () => {
  const slides = parseDeck(TIED, 'one-chapter').slides
  const anchors = anchorsIn(focusOn(parts()), slides, PROJECT, EPIC)
  expect(anchors(0)).toEqual([{ file: `${PROJECT}/${PAPER}/chapters/intro.tex` }])
  expect(anchors(1)).toEqual([])
  expect(anchors(2)).toEqual([{ file: `${PROJECT}/${PAPER}/main.tex` }])
  expect(anchors(3)).toEqual([{ file: `${PROJECT}/${PAPER}/chapters/methods.tex` }])
  /* With no parts at all nothing is tied to one — and nothing is picked, so it decides nothing. */
  expect(anchorsIn(focusOn([]), slides, PROJECT, EPIC)(0)).toEqual([{ whole: true }])
})

for (const shape of ['files', 'documents'] as const) {
  describe(`which slides a pick shows — a host that sends ${shape === 'files' ? 'only `files`' : '`documents`'}`, () => {
    const slides = parseDeck(DECK, 'defence').slides
    const narrow = (picked: string[], held: number | null = null) => narrowDeck(focusOn(partsAs(shape, ...picked)), slides, PROJECT, EPIC, held)

    test('nothing ticked is the whole deck', () => {
      expect(narrow([])).toEqual({ focused: false, shown: [0, 1, 2, 3, 4], held: null, sourced: [1, 2, 3], empty: '' })
      /* And holding a slide means nothing then. */
      expect(narrow([], 1).held).toBeNull()
    })

    test('a part is the slides linked into its files or citing them, between the title and the closing slide', () => {
      expect(narrow(['methods']).shown).toEqual([0, 2, 3, 4])
      expect(narrow(['intro']).shown).toEqual([0, 1, 2, 4])
      expect(narrow(['intro', 'methods']).shown).toEqual([0, 1, 2, 3, 4])
      /* A part no slide is in: the title and the closing slide are part of it, as of every part. */
      expect(narrow(['results']).shown).toEqual([0, 4])
    })

    test('slides of other parts are not shown, and nor is a slide in the middle that no part has', () => {
      const tied = parseDeck(TIED, 'one-chapter').slides
      const of = (...picked: string[]) => narrowDeck(focusOn(partsAs(shape, ...picked)), tied, PROJECT, EPIC, null)
      expect(of('intro').shown).toEqual([0])
      expect(of('methods').shown).toEqual([3])
      expect(of('results')).toEqual({ focused: true, shown: [], held: null, sourced: [], empty: 'No slide is in the picked part.' })
    })

    test('the slide in hand is kept in its place in the order, and named', () => {
      expect(narrow(['methods'], 1)).toMatchObject({ focused: true, shown: [0, 1, 2, 3, 4], held: 1 })
      /* One that is in the pick anyway is not "held". */
      expect(narrow(['methods'], 3)).toMatchObject({ focused: true, shown: [0, 2, 3, 4], held: null })
      expect(narrow(['methods'], 0)).toMatchObject({ shown: [0, 2, 3, 4], held: null })
    })

    test('the part’s own slides are told from the title and closing slide shown with them, and from the one held', () => {
      expect(narrow(['methods']).sourced).toEqual([2, 3])
      expect(narrow(['methods'], 1).sourced).toEqual([2, 3])
      expect(narrow(['results']).sourced).toEqual([])
    })
  })
}

describe('around the shown slides', () => {
  const slides = parseDeck(DECK, 'defence').slides
  const narrow = (picked: string[]) => narrowDeck(focusOn(parts(...picked)), slides, PROJECT, EPIC, null)

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
    expect(positionSaid(narrow(['methods']), 3, 5)).toBe('3 of 4 · slide 4 of 5')
    const none = narrowDeck(focusOn(parts('results')), parseDeck(TIED, 'one-chapter').slides, PROJECT, EPIC, null)
    expect(positionSaid(none, null, 4)).toBe('0 of 0 · 4 in the deck')
  })

  test('the one sentence, for a pick that leaves no slide: the protocol’s', () => {
    expect(narrow(['results']).empty).toBe('No slide is in the picked part.')
    expect(narrow(['results', 'intro']).empty).toBe('No slide is in the picked parts.')
    expect(narrow([]).empty).toBe('')
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

    /* Methods: its slides, between the title and the closing slide — which are part of every part, so the title
       stays where it is. The introduction's own slide is not drawn. */
    view.rerender(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    expect(onScreen()).toBe('Title')
    expect(counter()).toBe('1 of 4 · slide 1 of 5')
    expect(preview().getByRole('button', { name: 'previous slide' }).hasAttribute('disabled')).toBe(true)
    silent()
    expect(editor().value).toBe(DECK)

    /* Stepping stays inside the pick: over the slide that is not in it. */
    fireEvent.click(preview().getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(counter()).toBe('2 of 4 · slide 3 of 5')
    fireEvent.click(preview().getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    expect(counter()).toBe('3 of 4 · slide 4 of 5')
    await pause(30)

    /* Another part instead: slide 4 is not in it, and the deck goes to the nearest of that part's OWN slides — slide
       3, not the closing slide beside it, which is as near and is shown under every pick. */
    view.rerender(at(fake, ['intro']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 2', 'slide 3', 'slide 5']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(counter()).toBe('3 of 4 · slide 3 of 5')
    silent()

    /* Two: the slide in front is still in the pick, so it stays. */
    view.rerender(at(fake, ['intro', 'methods']))
    await waitFor(() => expect(strip()).toHaveLength(5))
    expect(onScreen()).toBe('How')
    expect(counter()).toBe('3 of 5 · slide 3 of 5')

    /* A part no slide is in: there is none of its own to go to, so the nearest shown one — the closing slide. */
    view.rerender(at(fake, ['results']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 5']))
    await waitFor(() => expect(onScreen()).toBe('In short'))
    expect(counter()).toBe('2 of 2 · slide 5 of 5')

    /* None: the whole deck again, on the slide it was on. */
    view.rerender(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    expect(onScreen()).toBe('In short')
    expect(counter()).toBe('5 / 5')
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
    const fake = fakeDecks({}, { text: TIED })
    render(at(fake, ['results']))
    await waitFor(() => expect(preview().getByTestId('focus-empty').textContent).toBe('No slide is in the picked part.'))
    expect(strip()).toEqual([])
    expect(onScreen()).toBeNull()
    expect(counter()).toBe('0 of 0 · 4 in the deck')
    expect(editor().value).toBe(TIED)
    expect(screen.queryByTestId('focus')).toBeNull()
  })

  test('a pick no slide is in still has the title and the closing slide, and says nothing', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['results']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 5']))
    expect(onScreen()).toBe('Title')
    expect(counter()).toBe('1 of 2 · slide 1 of 5')
    expect(preview().queryByTestId('focus-empty')).toBeNull()
    silent()
  })

  test('the caret put in a slide outside the pick, in the Markdown: that slide is in hand — drawn, set back in the strip, and gone when left', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    caretAt(DECK.indexOf('## Why'))
    await waitFor(() => expect(onScreen()).toBe('Why'))
    expect(strip()).toEqual(['slide 1', 'slide 2', 'slide 3', 'slide 4', 'slide 5'])
    const held = within(screen.getByRole('navigation', { name: 'slides' })).getByRole('button', { name: 'slide 2' })
    expect(held.hasAttribute('data-held')).toBe(true)
    expect(held.className).toContain('opacity-50')
    /* Set back, and that is all: no words about the pick on it. */
    expect(held.hasAttribute('title')).toBe(false)
    expect(counter()).toBe('2 of 5 · slide 2 of 5')
    silent()

    caretAt(DECK.indexOf('## Design'))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5'])
  })

  test('a slide outside the pick that is pointed at from outside is drawn as the slide in hand', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    fake.point(1, 10)
    await waitFor(() => expect(onScreen()).toBe('Why'))
    expect(strip()).toEqual(['slide 1', 'slide 2', 'slide 3', 'slide 4', 'slide 5'])
    expect(counter()).toBe('2 of 5 · slide 2 of 5')
    /* And the door is told it is outside the pick, which is what show_slide's answer then says. */
    expect(fake.of('pointed').map((call) => call.args.slice(2))).toEqual([[10, 'outside', false]])
    /* One inside the pick lets the slide in hand go, and is plainly shown. */
    fake.point(2, 11)
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    expect(fake.of('pointed').map((call) => call.args.slice(2)).at(-1)).toEqual([11, 'shown', false])
    silent()
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
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 2', 'slide 3', 'slide 4', 'slide 5']))
    expect(onScreen()).toBe('Why now')
    expect(editor().value).toBe(typed)
    await waitFor(() => expect(fake.disk.text).toBe(typed))
  })

  test('stepping onto a slide shown for what it cites does not turn the paper to its section in another part’s file', async () => {
    asked.length = 0
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    fireEvent.click(preview().getByRole('button', { name: 'next slide' }))
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
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    const stage = screen.getByTestId('stage')
    expect(stage.getAttribute('data-presenting')).not.toBeNull()
    expect(within(stage).getByRole('heading').textContent).toBe('Title')
    /* Over the introduction's slide, which is not in the pick. */
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('How'))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('Design'))
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('In short'))
    /* The last of the shown slides: there is nothing to go on to. */
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await pause(20)
    expect(within(stage).getByRole('heading').textContent).toBe('In short')
    fireEvent.keyDown(window, { key: 'Home' })
    await waitFor(() => expect(within(stage).getByRole('heading').textContent).toBe('Title'))
    /* Nothing on the stage about the pick. */
    expect(stage.textContent).not.toContain('picked')
    fireEvent.keyDown(window, { key: 'Escape' })
  })

  test('the paper on a section whose slide is outside the pick: not jumped to, and the following control says where it is', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const reading = { path: `${PROJECT}/${PAPER}/chapters/intro.tex`, page: 2, from: null, to: null, quoted: '', section: { title: 'Introduction', from: 0, to: 10 } }
    const view = render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    view.rerender(at(fake, ['methods'], { passage: reading }))
    /* Where the slide is, and not a word about what is picked: that is the host's to say. */
    await waitFor(() => expect(screen.getByTestId('following').getAttribute('aria-label')).toBe('Slide 2, for Introduction, is not among the slides shown'))
    expect(onScreen()).toBe('Title')
    expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5'])
    /* With nothing picked the same reading is followed, as it always was. */
    view.rerender(at(fake, [], { passage: { ...reading, section: { title: 'Design', from: 0, to: 9 }, path: `${PROJECT}/${PAPER}/chapters/methods.tex` } }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
  })
})

/**
 * The keyboard. A move the canvas made — a part picked, the paper turned, a slide pointed at — must not take focus
 * into this frame: the person is somewhere else, and in the host's parts picker the moment this frame takes focus the
 * picker closes under them. Only a press of their own, inside this page, puts the keyboard in the Markdown.
 */
describe('the keyboard is taken only by the person’s own move', () => {
  const last = () => jumped.at(-1)

  test('a pick that moves the deck to another slide moves the caret and does not ask for focus', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    caretAt(DECK.indexOf('## Why'))
    await waitFor(() => expect(onScreen()).toBe('Why'))
    const before = jumped.length
    /* Methods: "Why" is not in it, so the pick itself moves the deck. */
    view.rerender(at(fake, ['methods']))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(jumped.length).toBeGreaterThan(before)
    expect(jumped.slice(before).map((one) => one.focus)).toEqual(jumped.slice(before).map(() => false))
    expect(last()?.focus).toBe(false)
    /* And unpicking, picking another, picking two: none of them asks either. */
    for (const picked of [['intro'], ['intro', 'methods'], [], ['results']]) {
      view.rerender(at(fake, picked))
      await pause(20)
    }
    expect(jumped.slice(before).filter((one) => one.focus)).toEqual([])
  })

  test('the paper turning, and a slide pointed at from outside, move the deck without asking for focus', async () => {
    const fake = fakeDecks({}, { text: DECK })
    const view = render(at(fake, []))
    await waitFor(() => expect(strip()).toHaveLength(5))
    const before = jumped.length
    const reading = { path: `${PROJECT}/${PAPER}/chapters/methods.tex`, page: 2, from: null, to: null, quoted: '', section: { title: 'Design', from: 0, to: 9 } }
    view.rerender(at(fake, [], { passage: reading }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    fake.point(1, 10)
    await waitFor(() => expect(onScreen()).toBe('Why'))
    expect(jumped.length).toBeGreaterThan(before + 1)
    expect(jumped.slice(before).filter((one) => one.focus)).toEqual([])
  })

  test('a thumbnail pressed, and a step taken, are the person’s own: the keyboard goes to the Markdown', async () => {
    const fake = fakeDecks({}, { text: DECK })
    render(at(fake, ['methods']))
    await waitFor(() => expect(strip()).toEqual(['slide 1', 'slide 3', 'slide 4', 'slide 5']))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'slides' })).getByRole('button', { name: 'slide 4' }))
    await waitFor(() => expect(onScreen()).toBe('Design'))
    expect(last()?.focus).toBe(true)
    fireEvent.click(preview().getByRole('button', { name: 'previous slide' }))
    await waitFor(() => expect(onScreen()).toBe('How'))
    expect(last()?.focus).toBe(true)
  })
})

test('the manifest says it follows the parts', () => {
  expect(MANIFEST.reacts).toContain('parts')
  expect(partsDeclaration(MANIFEST)).toEqual([])
})
