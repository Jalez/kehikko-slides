import { describe, expect, test } from 'bun:test'

import { addCitation } from '../deck/cite.ts'
import { deckProblems, parseDeck, parseSlide, serialiseSlide } from '../deck/format.ts'
import { withMarkers } from '../src/slides/citations.tsx'

const SLIDE = `<!-- section: chapters/4.tex | Results -->
# RQ1
- Mean **3.51**[^1] after the first module
- Neutral throughout[^2]
Sources:
[^1]: chapters/4.tex | "The mean rating was highest after the vanilla-JavaScript module (3.51)."
[^2]: chapters/4.tex | "The neutral category was the most common response in every module."
Notes:
Say it slowly.`

describe('the Sources block', () => {
  test('is read apart from the body and the notes', () => {
    const slide = parseSlide(SLIDE)
    expect(slide.body).toBe('# RQ1\n- Mean **3.51**[^1] after the first module\n- Neutral throughout[^2]')
    expect(slide.notes).toBe('Say it slowly.')
    expect(slide.sources).toEqual([
      { label: '1', path: 'chapters/4.tex', quote: 'The mean rating was highest after the vanilla-JavaScript module (3.51).' },
      { label: '2', path: 'chapters/4.tex', quote: 'The neutral category was the most common response in every module.' },
    ])
    expect(slide.strays).toEqual([])
  })

  test('round-trips byte for byte', () => {
    expect(serialiseSlide(parseSlide(SLIDE))).toBe(SLIDE)
  })

  test('a quote may hold | and " — the path ends at the first bar, the quote at the last quote mark', () => {
    const slide = parseSlide('# x\nSources:\n[^a]: ch.tex | "a | b "c" d"')
    expect(slide.sources[0]).toEqual({ label: 'a', path: 'ch.tex', quote: 'a | b "c" d' })
  })

  test('a line that is not a source is kept, and reported', () => {
    const text = '# x[^1]\nSources:\n[^1]: ch.tex | "words"\nsee chapter four'
    const slide = parseSlide(text)
    expect(slide.strays).toEqual(['see chapter four'])
    expect(serialiseSlide(slide)).toBe(text)
    expect(deckProblems(text).join(' ')).toContain('see chapter four')
  })

  test('a marker with no source, a label given twice and a path outside the project are problems', () => {
    expect(deckProblems('# x[^9]')).toEqual(['Slide 0: [^9] is on the slide but has no line under Sources:.'])
    expect(deckProblems('# x\nSources:\n[^1]: a.tex | "one"\n[^1]: a.tex | "two"').join(' ')).toContain('two sources')
    expect(deckProblems('# x\nSources:\n[^1]: ../a.tex | "one"').join(' ')).toContain('inside it')
    /* A source no marker names cites the slide as a whole: not a problem. */
    expect(deckProblems('# x\nSources:\n[^1]: a.tex | "one"')).toEqual([])
  })

  test('a deck with no sources reads as before', () => {
    expect(parseDeck('# One\n\n---\n\n# Two\nNotes:\nhi').slides.map((s) => s.sources)).toEqual([[], []])
  })
})

/* The line, the markers and finding a quote are `kehikot-module-protocol`'s,
   and tested there (`test/citations.test.ts`). What is a deck's own is that a
   slide's body is Markdown, so a marker inside code is code. */
describe('markers on a slide', () => {
  test('one written inside code is not a citation: it needs no source', () => {
    expect(deckProblems('a[^1] `b[^2]`\n```\nd[^4]\n```\nSources:\n[^1]: a.tex | "one"')).toEqual([])
  })

  test('and is drawn as the code it is, where the others become links or are taken out', () => {
    expect(withMarkers('a[^1] `b[^2]`', true)).toBe('a[1](#cite-1) `b[^2]`')
    expect(withMarkers('a[^1] `b[^2]`', false)).toBe('a `b[^2]`')
  })
})

describe('citing', () => {
  const DECK = '---\ntitle: T\n---\n\n# One\n\n---\n\n# Two\n- Mean 3.51 after vanilla\n- Neutral throughout\nNotes:\nhi\n'
  const cited = { path: 'chapters/4.tex', quote: 'The mean rating\n   was highest' }

  test('after some words: a marker there and a numbered source, other slides untouched', () => {
    const done = addCitation(DECK, 1, cited, { after: '3.51' })
    expect(done).toMatchObject({ label: '1' })
    const text = (done as { text: string }).text
    expect(text.startsWith('---\ntitle: T\n---\n\n# One\n\n---\n\n')).toBe(true)
    expect(text).toContain('- Mean 3.51[^1] after vanilla')
    expect(text).toContain('Sources:\n[^1]: chapters/4.tex | "The mean rating was highest"\nNotes:\nhi')
    expect(deckProblems(text)).toEqual([])
  })

  test('the same words again reuse their label; new words take the next', () => {
    const once = (addCitation(DECK, 1, cited, { after: '3.51' }) as { text: string }).text
    const again = addCitation(once, 1, cited, { after: 'Neutral throughout' }) as { text: string; label: string }
    expect(again.label).toBe('1')
    expect(again.text).toContain('- Neutral throughout[^1]')
    expect(parseDeck(again.text).slides[1]!.sources).toHaveLength(1)
    const other = addCitation(once, 1, { path: 'chapters/4.tex', quote: 'other' }, { whole: true }) as { label: string }
    expect(other.label).toBe('2')
  })

  test('at the caret: the end of the caret’s line', () => {
    const caret = DECK.indexOf('Neutral') + 3
    const text = (addCitation(DECK, 1, cited, { caret }) as { text: string }).text
    expect(text).toContain('- Neutral throughout[^1]\nSources:')
  })

  test('refusals say why', () => {
    expect(addCitation(DECK, 1, cited, { after: 'nowhere' })).toMatchObject({ error: expect.stringContaining('not on slide 1') })
    expect(addCitation(DECK, 1, cited, { after: 'e' })).toMatchObject({ error: expect.stringContaining('more than once') })
    expect(addCitation(DECK, 7, cited, { whole: true })).toMatchObject({ error: 'There is no slide 7.' })
    expect(addCitation(DECK, 1, { path: '/etc/passwd', quote: 'x' }, { whole: true })).toMatchObject({ error: expect.stringContaining('inside it') })
  })
})
