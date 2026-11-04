import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, LIMITS } from 'kehikot-module-protocol'

import { footerItems, type FooterState } from '../src/footer.ts'
import { headerOf, type Work } from '../src/header.ts'

const work: Work = {
  tab: 'edit',
  following: true,
  followingSays: 'Following the paper',
  slides: [{ index: 0, headline: 'One' }, { index: 1, headline: 'Two' }, { index: 2, headline: '' }],
  current: 1,
  count: 3,
  presenting: false,
  position: '2 / 3',
  before: 0,
  after: 2,
}
const base: FooterState = { work, deck: 'Defence', save: 'saved', trouble: null }
const ids = (state: FooterState) => footerItems(state).map((one) => one.id)
const find = (state: FooterState, id: string) => footerItems(state).find((one) => one.id === id)

describe('what the page declares for the footer', () => {
  test('every list it can make parses, whatever the deck', () => {
    const long: FooterState = {
      work: {
        ...work,
        slides: Array.from({ length: 300 }, (_, index) => ({ index, headline: 'A headline that is rather longer than forty-eight characters' })),
        current: 150,
        count: 300,
        position: `${'x'.repeat(200)}`,
      },
      deck: 'A deck title that goes on '.repeat(10),
      save: 'conflict',
      trouble: 'Could not reach the store '.repeat(20),
    }
    for (const state of [base, long, { work: null, deck: null, save: null, trouble: null }]) {
      expect(footerItemsSchema.safeParse(footerItems(state)).success).toBe(true)
    }
    expect(footerItems(long).length).toBeLessThanOrEqual(LIMITS.FOOTER_ITEMS)
  })

  test('a deck open: Previous, the slide x of y, Next and the slides to go to, then the save word and the deck', () => {
    expect(ids(base)).toEqual(['previous', 'position', 'next', 'slide', 'save', 'shown'])
    expect(find(base, 'position')).toMatchObject({ kind: 'text', text: '2 / 3', tooltip: 'Slide 2 of 3: Two' })
    expect(find(base, 'previous')).toMatchObject({ kind: 'run', icon: 'chevron-left', disabled: null })
    expect(find(base, 'next')).toMatchObject({ kind: 'run', icon: 'chevron-right', disabled: null })
    expect(find(base, 'slide')).toMatchObject({ kind: 'go', tool: 'show_slide', optional: true })
    expect(find(base, 'save')).toMatchObject({ kind: 'text', text: 'saved', align: 'end' })
    expect(find(base, 'save')).not.toHaveProperty('level')
    expect(find(base, 'shown')).toMatchObject({ kind: 'text', text: 'Defence', align: 'end', optional: true })
  })

  test('at either end the arrow says why it cannot step; a talk is stepped with its own keys', () => {
    expect(find({ ...base, work: { ...work, before: null } }, 'previous')).toMatchObject({ disabled: 'This is the first slide shown.' })
    expect(find({ ...base, work: { ...work, after: null } }, 'next')).toMatchObject({ disabled: 'This is the last slide shown.' })
    const talking = { ...base, work: { ...work, presenting: true } }
    expect(find(talking, 'previous')).toMatchObject({ disabled: expect.stringContaining('talk') })
    expect(find(talking, 'next')).toMatchObject({ disabled: expect.stringContaining('talk') })
  })

  test('a save that did not land, and a store that failed, are said as trouble', () => {
    expect(find({ ...base, save: 'conflict' }, 'save')).toMatchObject({ text: 'not saved', level: 'critical' })
    expect(find({ ...base, save: 'failed' }, 'save')).toMatchObject({ text: 'not saved', level: 'critical' })
    expect(find({ ...base, save: 'saving' }, 'save')).toMatchObject({ text: 'saving…' })
    const failed = { ...base, trouble: 'The store did not answer.' }
    expect(ids(failed)[0]).toBe('trouble')
    expect(find(failed, 'trouble')).toMatchObject({ kind: 'text', level: 'critical', text: 'The store did not answer.' })
  })

  test('no deck open: nothing but the trouble, if any', () => {
    expect(ids({ work: null, deck: null, save: null, trouble: null })).toEqual([])
    expect(ids({ work: null, deck: null, save: null, trouble: 'Gone.' })).toEqual(['trouble'])
  })

  test('the pick leaving the slide out: the position says so', () => {
    const left = { ...base, work: { ...work, current: null, position: '0 of 0 · 3 in the deck' } }
    expect(find(left, 'position')).toMatchObject({ text: '0 of 0 · 3 in the deck', tooltip: 'No slide of the 3 is among those shown.' })
  })

  test('never the same item in both rows: with a footer, the header names no slide and no deck', () => {
    const header = headerOf({ decks: [{ slug: 'defence', title: 'Defence' }], open: 'defence', work, footed: true })
    const footer = footerItems(base)
    expect(header.find((one) => one.id === 'slide')).toBeUndefined()
    expect(header.find((one) => one.id === 'deck')).toMatchObject({ label: 'Decks' })
    const both = header.filter((one) => footer.some((two) => two.id === one.id))
    expect(both).toEqual([])
    /* Present, Presenter view, Export PDF and History stay the header's runs. */
    expect(header.map((one) => one.id)).toEqual(expect.arrayContaining(['present', 'presenter', 'export', 'history']))
  })
})
