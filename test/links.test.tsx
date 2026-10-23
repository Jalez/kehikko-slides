import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { AddressOpenResult } from 'kehikot-module-protocol'

import { parseSlide } from '../deck/format.ts'
import { MANIFEST } from '../manifest.ts'
import { OpenAddressContext, handLink, handsLink, openerOf, stillFollow } from '../src/lib/links.ts'
import { SlideView } from '../src/slides/slide-view.tsx'

/**
 * A link in a slide, handed to the canvas (`address.open`, protocol 2.16.0)
 * when the host answers it; a new tab otherwise.
 */

afterEach(cleanup)
beforeAll(() => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://127.0.0.1:7990/app'))

const answer = (outcome: AddressOpenResult['outcome']): AddressOpenResult => ({ outcome, why: '' })
const ADDRESS = 'https://example.com/source'
const slide = () => parseSlide(`## The claim\nSee [the source](${ADDRESS}) and [a plain one](http://example.com/plain).`)
const link = (view: HTMLElement, text: string) => [...view.querySelectorAll('a')].find((one) => one.textContent === text)!

test('the manifest asks the host to open addresses', () => {
  expect(MANIFEST.declares.uses).toContain('address:open')
})

describe('handsLink and openerOf', () => {
  test('only with a host that takes addresses, and only an address the protocol takes', () => {
    const open = () => Promise.resolve(answer('shown'))
    expect(handsLink(ADDRESS, open)).toBe(true)
    expect(handsLink(ADDRESS, null)).toBe(false)
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://u:p@example.com', '', null]) {
      expect(handsLink(url, open)).toBe(false)
    }
  })

  test('a host hands addresses over only when its greeting says it answers address.open', () => {
    const openAddress = () => Promise.resolve(answer('shown'))
    expect(openerOf({ openAddress, answers: ['address.open'] })).not.toBeNull()
    expect(openerOf({ openAddress, answers: ['view.goto'] })).toBeNull()
    expect(openerOf({ openAddress, answers: null })).toBeNull()
    expect(openerOf({ answers: ['address.open'] })).toBeNull()
  })
})

describe('after handing it over', () => {
  test('shown or offered: nothing more is opened', async () => {
    for (const outcome of ['shown', 'offered'] as const) {
      expect(stillFollow(answer(outcome))).toBe(false)
      const opened: string[] = []
      await handLink(ADDRESS, () => Promise.resolve(answer(outcome)), (url) => void opened.push(url))
      expect(opened).toEqual([])
    }
  })
  test('declined or unanswered: the old new tab', async () => {
    for (const given of [answer('declined'), null]) {
      const opened: string[] = []
      await handLink(ADDRESS, () => Promise.resolve(given), (url) => void opened.push(url))
      expect(opened).toEqual([ADDRESS])
    }
  })
})

describe('a link in a slide', () => {
  test('inside a host that takes addresses, a press hands the address over and is not followed', () => {
    const asked: string[] = []
    const { container } = render(
      <OpenAddressContext.Provider value={(url) => (asked.push(url), Promise.resolve(answer('offered')))}>
        <SlideView slide={slide()} />
      </OpenAddressContext.Provider>,
    )
    expect(fireEvent.click(link(container, 'the source'))).toBe(false)
    expect(asked).toEqual([ADDRESS])
  })

  test('a link the protocol would not take is followed as a link, and not handed over', () => {
    const asked: string[] = []
    const { container } = render(
      <OpenAddressContext.Provider value={(url) => (asked.push(url), Promise.resolve(answer('shown')))}>
        <SlideView slide={slide()} />
      </OpenAddressContext.Provider>,
    )
    expect(fireEvent.click(link(container, 'a plain one'))).toBe(true)
    expect(asked).toEqual([])
  })

  test('without a host that takes addresses, an ordinary new-tab link', () => {
    const { container } = render(<SlideView slide={slide()} />)
    const one = link(container, 'the source') as HTMLAnchorElement
    expect(one.target).toBe('_blank')
    expect(one.rel).toBe('noreferrer')
    expect(fireEvent.click(one)).toBe(true)
  })
})
