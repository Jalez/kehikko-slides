import { describe, expect, test } from 'bun:test'

import { parseDeck, setSection, unlinkable } from '../deck/format.ts'
import {
  ECHO_GRACE_MS,
  Follower,
  absolute,
  passageFor,
  projectRelative,
  readingOf,
  type Situation,
} from '../src/follow.ts'

const PROJECT = '/work/thesis'
const CHAPTER = '/work/thesis/chapters/2.tex'

const DECK = `---
title: Defence
---

# Title

---

<!-- section: chapters/2.tex | Bridging the gap -->
## The problem

---

<!-- section: ./chapters/2.tex | Bridging the gap -->
## More of it

---

<!-- section: chapters/2.tex | Results -->
## Results

---

## Thanks
`
const slides = parseDeck(DECK).slides
const at = (current: number): Situation => ({ slides, current, project: PROJECT })
const reading = (title: string, path = CHAPTER) => ({ path, title })

/** A follower on a clock the test turns. */
function follower() {
  let now = 1_000
  const one = new Follower(() => now)
  return { one, tick: (ms: number) => (now += ms) }
}

describe('paths', () => {
  test('a project-relative path is joined onto the project, and back', () => {
    expect(absolute('/work/thesis/', './chapters/2.tex')).toBe(CHAPTER)
    expect(projectRelative(PROJECT, CHAPTER)).toBe('chapters/2.tex')
    expect(projectRelative(PROJECT, '/work/thesis-old/a.tex')).toBeNull()
    expect(projectRelative(PROJECT, '/work/thesis/../x.tex')).toBeNull()
  })

  test('only a passage with a section is a reading', () => {
    expect(readingOf(null)).toBeNull()
    expect(readingOf({ path: CHAPTER, section: null })).toBeNull()
    expect(readingOf({ path: CHAPTER, section: { title: 'Results' } })).toEqual(reading('Results'))
  })
})

describe('paper → slides', () => {
  test('a new section moves to the first slide linked to it', () => {
    const { one } = follower()
    expect(one.read(reading('Bridging the gap'), at(0), true)).toBe(1)
    expect(one.missing).toBeNull()
  })

  test('stays when the slide on screen is already linked to it', () => {
    const { one } = follower()
    expect(one.read(reading('Bridging the gap'), at(2), true)).toBeNull()
  })

  test('no slide for the section: stays, and says which section', () => {
    const { one } = follower()
    expect(one.read(reading('Appendix'), at(3), true)).toBeNull()
    expect(one.missing).toBe('Appendix')
    expect(one.read(reading('Results'), at(0), true)).toBe(3)
    expect(one.missing).toBeNull()
  })

  test('the same section said again is not a change', () => {
    const { one } = follower()
    expect(one.read(reading('Results'), at(0), true)).toBe(3)
    /* The person moved away; the host re-sends its context for some other reason. */
    one.moved(3, at(3), true)
    expect(one.read(reading('Results'), at(0), true)).toBeNull()
  })

  test('the same title in another file is another section', () => {
    const { one } = follower()
    expect(one.read(reading('Results', '/work/thesis/chapters/3.tex'), at(0), true)).toBeNull()
    expect(one.missing).toBe('Results')
  })

  test('turned off, nothing moves; turned back on, it catches up', () => {
    const { one } = follower()
    expect(one.read(reading('Results'), at(0), false)).toBeNull()
    expect(one.read(reading('Results'), at(0), false)).toBeNull()
    one.reset()
    expect(one.read(reading('Results'), at(0), true)).toBe(3)
  })
})

describe('slides → paper', () => {
  test('a move to a linked slide publishes its section, absolutely', () => {
    const { one } = follower()
    expect(one.moved(3, at(3), true)).toEqual({
      path: CHAPTER,
      page: null,
      from: null,
      to: null,
      quoted: '',
      section: { title: 'Results', from: null, to: null },
    })
    expect(one.moved(4, at(4), true)).toBeNull()
  })

  test('a move made by following is not published back', () => {
    const { one } = follower()
    expect(one.read(reading('Results'), at(0), true)).toBe(3)
    expect(one.moved(3, at(3), true)).toBeNull()
    /* …but the person's next move is. */
    expect(one.moved(1, at(1), true)?.section.title).toBe('Bridging the gap')
  })

  test('nothing is published while following is off', () => {
    const { one } = follower()
    expect(one.moved(3, at(3), false)).toBeNull()
  })

  test('the paper already there is not told again', () => {
    const { one } = follower()
    one.read(reading('Bridging the gap'), at(1), true)
    expect(one.moved(2, at(2), true)).toBeNull()
  })

  test('the echo of our own publish is not followed', () => {
    const { one } = follower()
    const passage = one.moved(2, at(2), true)!
    one.published(passage)
    /* Slide 2 is the SECOND slide for this section; following the echo would jump to slide 1. */
    expect(one.read(reading('Bridging the gap'), at(2), true)).toBeNull()
  })

  test('while the paper is on its way, where it was is not followed', () => {
    const { one, tick } = follower()
    one.read(reading('Results'), at(3), true)
    one.published(one.moved(1, at(1), true)!)
    expect(one.read(reading('Results'), at(1), true)).toBeNull()
    expect(one.read(reading('Appendix'), at(1), true)).toBeNull()
    expect(one.missing).toBeNull()
    tick(ECHO_GRACE_MS)
    /* Past the grace the paper's own moves are followed again… */
    expect(one.read(reading('Appendix'), at(1), true)).toBeNull()
    expect(one.missing).toBe('Appendix')
    expect(one.read(reading('Results'), at(1), true)).toBe(3)
  })

  test('a section sent and not yet said back is not sent twice', () => {
    const { one } = follower()
    one.published(one.moved(1, at(1), true)!)
    expect(one.moved(2, at(2), true)).toBeNull()
  })

  test('passageFor joins the slide path onto the project', () => {
    expect(passageFor('/p/', { path: 'a/b.tex', title: 'T' }).path).toBe('/p/a/b.tex')
  })
})

describe('linking a slide', () => {
  test('writes the directive into that slide only', () => {
    const next = setSection(DECK, 4, { path: 'chapters/4.tex', title: 'Thanks' })!
    expect(parseDeck(next).slides[4]?.section).toEqual({ path: 'chapters/4.tex', title: 'Thanks' })
    expect(next.startsWith(DECK.slice(0, DECK.indexOf('## Thanks')))).toBe(true)
  })

  test('unlinks', () => {
    const next = setSection(DECK, 3, null)!
    expect(parseDeck(next).slides[3]?.section).toBeNull()
    expect(next).not.toContain('Results -->')
  })

  test('refuses what a directive cannot hold', () => {
    expect(unlinkable({ path: 'a.tex', title: 'A; B' })).toMatch(/cannot hold/)
    expect(setSection(DECK, 0, { path: 'a.tex', title: 'x --> y' })).toBeNull()
    expect(setSection(DECK, 9, { path: 'a.tex', title: 'A' })).toBeNull()
  })
})
