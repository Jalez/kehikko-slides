import { describe, expect, test } from 'bun:test'
import { headerItemsSchema, LIMITS } from 'kehikot-module-protocol'

import { cut, headerOf, slidesOffered, type HeaderState, type Work } from '../src/header.ts'

const work: Work = {
  tab: 'edit',
  following: true,
  followingSays: 'Following the paper',
  slides: [{ index: 0, headline: 'One' }, { index: 1, headline: '' }],
  current: 0,
  count: 2,
  presenting: false,
}
const base: HeaderState = { decks: [{ slug: 'a', title: 'A talk' }], open: 'a', work }

describe('what the page declares for the header', () => {
  test('every list it can make parses, whatever the decks', () => {
    const long: HeaderState = {
      decks: Array.from({ length: 90 }, (_, i) => ({ slug: `deck-${i}-${'x'.repeat(80)}`, title: `A title that goes on for longer than a label may, number ${i}` })),
      open: `deck-3-${'x'.repeat(80)}`,
      work: {
        ...work,
        followingSays: 'Slide 12 is not among those shown: A section with a very long name indeed',
        slides: Array.from({ length: 300 }, (_, index) => ({ index, headline: 'A headline that is rather longer than forty-eight characters' })),
        current: 150,
        count: 300,
        presenting: true,
      },
    }
    expect(headerItemsSchema.safeParse(headerOf(long)).success).toBe(true)
    expect(headerItemsSchema.safeParse(headerOf(base)).success).toBe(true)
    expect(headerItemsSchema.safeParse(headerOf({ decks: [], open: null, work: null })).success).toBe(true)
  })

  test('no deck open: the decks to go to and a new one, and nothing about a slide', () => {
    expect(headerOf({ ...base, open: null, work: null }).map((one) => one.id)).toEqual(['deck', 'deck-new'])
    expect(headerOf({ decks: [], open: null, work: null }).map((one) => one.id)).toEqual(['deck-new'])
  })

  test('the slide item names the tool that does the same for a program, and nothing is an agent’s to press', () => {
    const items = headerOf(base)
    expect(items.find((one) => one.id === 'slide')).toMatchObject({ kind: 'go', tool: 'show_slide', label: 'Slide 1 of 2' })
    expect(items.find((one) => one.id === 'deck')!.tool).toBeUndefined()
    expect(items.some((one) => one.agents)).toBe(false)
    expect(items.find((one) => one.id === 'deck-remove')).toMatchObject({ confirm: true })
  })

  test('while a talk is given, what would take the screen from it cannot be pressed, and says why', () => {
    const items = headerOf({ ...base, work: { ...work, presenting: true } })
    for (const id of ['present', 'history', 'deck-new', 'deck-rename', 'deck-remove']) {
      expect((items.find((one) => one.id === id) as { disabled?: string | null }).disabled).toContain('talk')
    }
  })

  test('a deck longer than a go item holds offers the slides around the one in front, moving in half-lengths', () => {
    const slides = Array.from({ length: 300 }, (_, index) => ({ index }))
    const at = (current: number) => slidesOffered(slides, current).map((one) => one.index)
    expect(at(0)).toHaveLength(LIMITS.HEADER_OPTIONS)
    expect(at(0)[0]).toBe(0)
    expect(at(150)).toContain(150)
    expect(at(299).at(-1)).toBe(299)
    /* Stepping one slide inside a window does not move it. */
    expect(at(150)).toEqual(at(151))
    expect(slidesOffered(slides.slice(0, 10), 3)).toHaveLength(10)
  })

  test('a label is one line, never empty, never longer than it may be', () => {
    expect(cut('  a\n b  ')).toBe('a b')
    expect(cut('')).toBe('—')
    expect(cut('x'.repeat(60)).length).toBe(LIMITS.HEADER_LABEL)
  })
})
