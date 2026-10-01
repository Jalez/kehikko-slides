import { describe, expect, test } from 'bun:test'

import { openPage, pageUrl } from '../src/open-window.ts'
import { clock } from '../src/presenter.tsx'
import { printCss } from '../src/print.tsx'
import { routeOf } from '../src/routes.ts'
import { TalkSync, step, talkKey } from '../src/talk.ts'

describe('the talk', () => {
  test('keys', () => {
    expect(['ArrowRight', 'ArrowDown', ' ', 'PageDown'].map(talkKey)).toEqual(['next', 'next', 'next', 'next'])
    expect(['ArrowLeft', 'ArrowUp', 'PageUp'].map(talkKey)).toEqual(['previous', 'previous', 'previous'])
    expect([talkKey('Home'), talkKey('End'), talkKey('b'), talkKey('Escape'), talkKey('x')]).toEqual([
      'first',
      'last',
      'blank',
      'leave',
      null,
    ])
  })

  test('steps stop at the ends, and a move unblanks', () => {
    expect(step('next', { index: 4, blank: false }, 5)).toEqual({ index: 4, blank: false })
    expect(step('previous', { index: 0, blank: true }, 5)).toEqual({ index: 0, blank: false })
    expect(step('last', { index: 0, blank: false }, 5)).toEqual({ index: 4, blank: false })
    expect(step('blank', { index: 2, blank: false }, 5)).toEqual({ index: 2, blank: true })
  })

  test('own echoes are ignored, other windows’ moves are taken, stale states are not', () => {
    const sync = new TalkSync(100)
    expect(sync.heard({ slug: 'd', index: 7, blank: false, at: 50 })).toBeNull()
    expect(sync.toPost(1, false)).toBe(true)
    expect(sync.toPost(2, false)).toBe(true)
    expect(sync.toPost(2, false)).toBe(false)
    expect(sync.heard({ slug: 'd', index: 1, blank: false, at: 200 })).toBeNull()
    expect(sync.heard({ slug: 'd', index: 2, blank: false, at: 201 })).toBeNull()
    expect(sync.heard({ slug: 'd', index: 5, blank: true, at: 300 })).toEqual({ index: 5, blank: true })
    /* Taken from the other window, so not posted back to it. */
    expect(sync.toPost(5, true)).toBe(false)
  })
})

describe('windows and routes', () => {
  test('routes', () => {
    expect(routeOf('http://h/app')).toEqual({ page: 'screen' })
    expect(routeOf('http://h/app?presenter=defence&project=%2Fw&theme=dark')).toEqual({
      page: 'presenter',
      slug: 'defence',
      project: '/w',
      theme: 'dark',
    })
    expect(routeOf('http://h/print?deck=defence&project=%2Fw')).toEqual({ page: 'print', slug: 'defence', project: '/w', theme: null })
  })

  test('addresses sit next to the page, and a blocked window is reported', () => {
    expect(pageUrl('./print', { deck: 'd', project: '/w x' }, 'http://127.0.0.1:7990/app')).toBe(
      'http://127.0.0.1:7990/print?deck=d&project=%2Fw+x',
    )
    expect(openPage('u', () => null)).toBe(false)
    expect(openPage('u', () => ({}) as Window)).toBe(true)
    expect(
      openPage('u', () => {
        throw new Error('no')
      }),
    ).toBe(false)
  })

  test('the page size is the slide size', () => {
    expect(printCss('16:9')).toContain('size: 1280px 720px; margin: 0')
    expect(printCss('4:3')).toContain('size: 960px 720px')
    expect(printCss('16:9')).toContain('print-color-adjust: exact')
  })

  test('clock', () => {
    expect([clock(0), clock(65), clock(3725)]).toEqual(['0:00', '1:05', '1:02:05'])
  })
})
