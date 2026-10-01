import { describe, expect, test } from 'bun:test'

import { deckProblems, parseDeck, replaceSlide, retitle, slideHeadline } from '../deck/format.ts'

const DECK = `---
title: Defence
epic: my-thesis
---

<!-- layout: title -->
# Bridging the gap

---

## The problem
- one

Notes:
Say why.

---

## The end
`

describe('editing a deck as text', () => {
  test('retitle changes only the title line', () => {
    const next = retitle(DECK, 'Viva')
    expect(next).toBe(DECK.replace('title: Defence', 'title: Viva'))
    expect(parseDeck(next).epic).toBe('my-thesis')
  })

  test('retitle adds a title, or front matter, where there is none', () => {
    expect(parseDeck(retitle('---\nepic: x\n---\n\n# One\n', 'T')).title).toBe('T')
    const bare = retitle('# One\n', 'Bare')
    expect(parseDeck(bare).title).toBe('Bare')
    expect(parseDeck(bare).slides[0]?.body).toBe('# One')
  })

  test('replaceSlide replaces one slide and keeps every other byte', () => {
    const next = replaceSlide(DECK, 1, '<!-- layout: quote -->\n> new\n\nNotes:\nhush')!
    expect(next).toBe(DECK.replace('## The problem\n- one\n\nNotes:\nSay why.', '<!-- layout: quote -->\n> new\n\nNotes:\nhush'))
    const deck = parseDeck(next)
    expect(deck.slides.length).toBe(3)
    expect(deck.slides[1]?.layout).toBe('quote')
    expect(deck.slides[1]?.notes).toBe('hush')
    expect(deck.slides[2]?.body).toBe('## The end')
  })

  test('replaceSlide works on the first and last slide, and refuses an index that is not a slide', () => {
    expect(parseDeck(replaceSlide(DECK, 0, '# First')!).slides[0]?.body).toBe('# First')
    expect(replaceSlide(DECK, 2, '# Last')!.endsWith('# Last\n')).toBe(true)
    expect(replaceSlide(DECK, 3, 'x')).toBeNull()
    expect(replaceSlide(DECK, -1, 'x')).toBeNull()
    expect(replaceSlide(DECK, 1.5, 'x')).toBeNull()
  })

  test('slideHeadline is the heading text', () => {
    expect(slideHeadline(parseDeck(DECK).slides[1]!)).toBe('The problem')
  })

  test('deckProblems names directives that did not land', () => {
    expect(deckProblems(DECK)).toEqual([])
    const problems = deckProblems('<!-- layout: wide -->\nx\n\n---\n\n<!-- section: no-bar -->\ny\n')
    expect(problems.length).toBe(2)
    expect(problems[0]).toContain('Slide 0')
    expect(problems[1]).toContain('Slide 1')
  })
})
