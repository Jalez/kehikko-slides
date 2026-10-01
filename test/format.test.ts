import { describe, expect, test } from 'bun:test'

import {
  columns,
  linkedTo,
  parseDeck,
  parseSlide,
  serialiseDeck,
  slideAt,
  slideRanges,
  slugFor,
} from '../deck/format.ts'

const DECK = `---
title: Defence
epic: my-thesis
---

<!-- layout: title -->
# Bridging the gap
A thesis defence

---

<!-- section: chapters/2_bridge.tex | Bridging the gap; mood: calm -->
## The problem
- one
- two

Notes:
Say why this matters.
`

describe('reading a deck', () => {
  test('front matter, slides, layouts, sections, notes', () => {
    const deck = parseDeck(DECK)
    expect(deck.title).toBe('Defence')
    expect(deck.epic).toBe('my-thesis')
    expect(deck.aspect).toBe('16:9')
    expect(deck.slides).toHaveLength(2)
    expect(deck.slides[0]).toMatchObject({ layout: 'title', section: null, body: '# Bridging the gap\nA thesis defence' })
    expect(deck.slides[1]).toMatchObject({
      layout: 'bullets',
      section: { path: 'chapters/2_bridge.tex', title: 'Bridging the gap' },
      extra: [['mood', 'calm']],
      body: '## The problem\n- one\n- two',
      notes: 'Say why this matters.',
    })
  })

  test('no front matter: the fallback title, and the first slide is not eaten', () => {
    const deck = parseDeck('# Hello\n\n---\n\n# Two', 'from-file')
    expect(deck.title).toBe('from-file')
    expect(deck.slides.map((s) => s.body)).toEqual(['# Hello', '# Two'])
  })

  test('an empty file is one empty slide', () => {
    expect(parseDeck('').slides).toHaveLength(1)
  })

  test('an unknown layout falls back to bullets; a section without a bar is not a link', () => {
    const slide = parseSlide('<!-- layout: spiral; section: nothing -->\nBody')
    expect(slide.layout).toBe('bullets')
    expect(slide.section).toBeNull()
    expect(slide.extra).toEqual([
      ['layout', 'spiral'],
      ['section', 'nothing'],
    ])
  })

  test('windows line endings read the same', () => {
    expect(parseDeck(DECK.replace(/\n/g, '\r\n')).slides[1]?.notes).toBe('Say why this matters.')
  })
})

describe('writing a deck', () => {
  test('a round trip keeps everything', () => {
    const once = parseDeck(DECK)
    expect(parseDeck(serialiseDeck(once))).toEqual(once)
  })

  test('the written form is stable', () => {
    const text = serialiseDeck(parseDeck(DECK))
    expect(serialiseDeck(parseDeck(text))).toBe(text)
  })
})

describe('where a caret is', () => {
  test('each slide has a range, and a caret maps to the slide it sits in', () => {
    const ranges = slideRanges(DECK)
    expect(ranges).toHaveLength(2)
    expect(DECK.slice(ranges[0]!.from, ranges[0]!.to)).toContain('# Bridging the gap')
    expect(slideAt(DECK, DECK.indexOf('A thesis'))).toBe(0)
    expect(slideAt(DECK, DECK.indexOf('- two'))).toBe(1)
    expect(slideAt(DECK, DECK.length)).toBe(1)
  })
})

describe('the small helpers', () => {
  test('columns split on |||', () => {
    expect(columns('left\n|||\nright')).toEqual(['left', 'right'])
    expect(columns('only')).toEqual(['only', ''])
  })

  test('a slug for a title', () => {
    expect(slugFor('Thesis Defence — v2!')).toBe('thesis-defence-v2')
    expect(slugFor('   ')).toBe('deck')
  })

  test('linked to a section by path and title', () => {
    const slide = parseDeck(DECK).slides[1]!
    expect(linkedTo(slide, 'chapters/2_bridge.tex', 'Bridging the gap')).toBe(true)
    expect(linkedTo(slide, 'chapters/2_bridge.tex', 'Other')).toBe(false)
  })
})
