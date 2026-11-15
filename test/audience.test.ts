import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { asker, type BeforeInfo } from 'kehikot-module-protocol/serve'

import { AWAY, audienceDoor, endAll, linksAlive, presenting, renew, working } from '../audience.ts'
import type { AudienceEvent, AudienceLink, AudienceState } from '../deck/api.ts'
import { TICKET, audienceStream, stream } from '../doors.ts'
import { moveTalk } from '../live.ts'
import { audienceUrl } from '../src/audience-link.tsx'
import { answer } from './now.ts'

/**
 * The audience view's server side: the presenter's link, the page, the stream that follows the presenter, and what
 * keeps it private. The door is called as the doors call it, with a `Request`; its streams are read as a browser
 * reads them.
 */

const home = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-slides-audience-')))
afterAll(() => rmSync(home, { recursive: true, force: true }))

const DECK = `---
title: The defence
---

# One
first

Notes:
Never shown: the examiner is the author of chapter 3.

---

## Two
- second

---

## Three
third
`

const PAGE = '<!doctype html><title>Slides</title><div id="root"></div>'
const door = audienceDoor({ document: async () => PAGE })
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

let n = 0
/** A project with the deck `d` in it, at its own folder. */
function project(): string {
  const dir = join(home, `p${(n += 1)}`)
  mkdirSync(join(dir, '.kehikot/slides'), { recursive: true })
  writeFileSync(join(dir, '.kehikot/slides/d.md'), DECK)
  return dir
}

/**
 * What the doors work out of a request before they hand it on. The headers a browser writes (`Origin`, `Sec-Fetch-*`) are
 * ones the test DOM's `Request` drops, so they are given here as the record the doors read them from.
 */
const infoOf = (request: Request, headers: Record<string, string>): BeforeInfo => ({ asker: asker(headers), url: new URL(request.url), ticket: null })

/** Ask the door as a browser would: from an address typed (`Sec-Fetch-Site: none`), or as given. */
async function ask(path: string, init: RequestInit & { sent?: Record<string, string> } = {}) {
  const { sent, ...rest } = init
  const request = new Request(`http://127.0.0.1:7990${path}`, rest)
  return door(request, infoOf(request, sent ?? { 'sec-fetch-site': 'none' }))
}

/** A reader of an event stream: the events so far, and what to wait for. */
async function follow(path: string) {
  const response = await ask(path)
  if (!response || response.status !== 200 || !response.body) throw new Error(`no stream: ${response?.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events: AudienceEvent[] = []
  let buffer = ''
  let done = false
  void (async () => {
    for (;;) {
      const { value, done: over } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (over) {
        done = true
        return
      }
      buffer += decoder.decode(value)
      for (;;) {
        const end = buffer.indexOf('\n\n')
        if (end < 0) break
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (data) events.push(JSON.parse(data))
      }
    }
  })()
  const until = async (test: (events: AudienceEvent[]) => boolean) => {
    for (let i = 0; i < 100 && !test(events); i += 1) await settle(10)
    return events
  }
  return { response, events, until, close: () => void reader.cancel(), over: () => done }
}

const states = (events: AudienceEvent[]) => events.filter((event): event is AudienceState & { ended?: false } => !('ended' in event && event.ended))

/** The presenter's window opens its stream; what it was handed is in `links`. */
function present(dir: string) {
  const links: AudienceLink[] = []
  const stop = presenting(dir, 'd', (link) => links.push(link))
  return { links, stop, key: () => links.at(-1)!.path.split('/').at(-1)! }
}

beforeEach(() => {
  AWAY.graceMs = 20
  AWAY.endsMs = 60_000
})
afterEach(() => {
  endAll()
  AWAY.graceMs = 3_000
  AWAY.endsMs = 30 * 60_000
})

describe('the link', () => {
  test('is on the page’s own address, which is the host’s stable one, with a key in it', () => {
    const { links, key } = present(project())
    expect(links[0]!.path).toMatch(/^\/audience\/[A-Za-z0-9_-]{32}$/)
    const url = audienceUrl(links[0]!.path, 'http://slides.kehikot.localhost:4170')
    expect(url).toBe(`http://slides.kehikot.localhost:4170/audience/${key()}`)
    /* Not the module's own port, which changes when it restarts: the address is whatever the window was opened on. */
    expect(url).not.toContain('7990')
  })

  test('is the same for the same deck, and different keys for different decks and projects', () => {
    const a = project()
    const b = project()
    const first = present(a)
    const again = present(a)
    expect(again.links[0]!.path).toBe(first.links[0]!.path)
    expect(present(b).links[0]!.path).not.toBe(first.links[0]!.path)
  })

  test('is not made by a page that does not hold the ticket, and is made for one that does', async () => {
    const dir = project()
    const refused = stream('GET', '/api/audience', new URLSearchParams({ project: dir, slug: 'd' }), () => {}, null)
    expect(refused).toMatchObject({ reply: { status: 403 } })
    const heard: AudienceLink[] = []
    const live = audienceStream('GET', '/api/audience', new URLSearchParams({ project: dir, slug: 'd', ticket: TICKET }), (link) => heard.push(link), null)
    expect(live && 'close' in live).toBe(true)
    await settle()
    expect(heard).toHaveLength(1)
    expect(working(heard[0]!.path.split('/').at(-1)!)).toBe(true)
  })
})

describe('the audience page', () => {
  test('is the page, and no other site can frame it', async () => {
    const { key } = present(project())
    const response = (await ask(`/audience/${key()}`))!
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PAGE)
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  test('is sent the slide and the deck’s shape, never the notes or where the project is', async () => {
    const dir = project()
    const { key } = present(dir)
    const stream = await follow(`/audience/${key()}/events`)
    const [first] = states(await stream.until((events) => events.length > 0))
    expect(first).toEqual({ presenter: true, blank: false, index: 0, count: 3, aspect: '16:9', slide: { layout: 'bullets', body: '# One\nfirst' } })
    const said = JSON.stringify(stream.events)
    expect(said).not.toContain('Never shown')
    expect(said).not.toContain('examiner')
    expect(said).not.toContain(dir)
    expect(said).not.toContain('notes')
    stream.close()
  })

  test('is handed no ticket: the document is built without one', async () => {
    const { buildless } = await import('./audience-document.ts')
    expect(await buildless()).not.toContain('kehikot-ticket')
  })
})

describe('following the presenter', () => {
  test('a move is pushed to every window following, at once', async () => {
    const dir = project()
    const { key } = present(dir)
    const one = await follow(`/audience/${key()}/events`)
    const two = await follow(`/audience/${key()}/events`)
    await one.until((events) => events.length > 0)
    await two.until((events) => events.length > 0)

    moveTalk(dir, 'd', 1, false)
    for (const stream of [one, two]) {
      const heard = states(await stream.until((events) => states(events).at(-1)?.index === 1))
      expect(heard.at(-1)).toMatchObject({ index: 1, slide: { body: '## Two\n- second' } })
    }
    moveTalk(dir, 'd', 2, false)
    expect(states(await one.until((events) => states(events).at(-1)?.index === 2)).at(-1)!.slide?.body).toBe('## Three\nthird')
    one.close()
    two.close()
  })

  test('a blank screen is a blank screen: no slide is sent', async () => {
    const dir = project()
    const { key } = present(dir)
    const stream = await follow(`/audience/${key()}/events`)
    moveTalk(dir, 'd', 1, true)
    expect(states(await stream.until((events) => states(events).at(-1)?.blank === true)).at(-1)).toMatchObject({ blank: true, index: 1, slide: null })
    stream.close()
  })

  test('a deck edited while it is shown is shown as edited', async () => {
    const dir = project()
    const { key } = present(dir)
    const stream = await follow(`/audience/${key()}/events`)
    await stream.until((events) => events.length > 0)
    writeFileSync(join(dir, '.kehikot/slides/d.md'), DECK.replace('first', 'FIRST, fixed'))
    const heard = states(await stream.until((events) => states(events).at(-1)?.slide?.body.includes('fixed') === true))
    expect(heard.at(-1)!.slide!.body).toBe('# One\nFIRST, fixed')
    stream.close()
  })

  test('a window that was cut off, or opened late, starts on the slide the presenter is on', async () => {
    const dir = project()
    const { key } = present(dir)
    const early = await follow(`/audience/${key()}/events`)
    await early.until((events) => events.length > 0)
    early.close()
    await settle()
    moveTalk(dir, 'd', 2, false)
    moveTalk(dir, 'd', 1, false)
    const late = await follow(`/audience/${key()}/events`)
    const heard = states(await late.until((events) => events.length > 0))
    expect(heard[0]).toMatchObject({ index: 1, presenter: true })
    /* One state, not the history: it is told where things are, not what it missed. */
    expect(heard).toHaveLength(1)
    late.close()
  })

  test('a stream that drops lets go of everything it watched', async () => {
    const dir = project()
    const { key } = present(dir)
    const one = await follow(`/audience/${key()}/events`)
    await one.until((events) => events.length > 0)
    const was = (await import('../live.ts')).watching()
    expect(was).toBeGreaterThan(0)
    one.close()
    await settle(60)
    expect((await import('../live.ts')).watching()).toBe(0)
  })

  test('the presenter is told how many windows follow, and when the count changes', async () => {
    const dir = project()
    const { links, key } = present(dir)
    const one = await follow(`/audience/${key()}/events`)
    await one.until((events) => events.length > 0)
    expect(links.at(-1)!.viewers).toBe(1)
    one.close()
    await settle()
    expect(links.at(-1)!.viewers).toBe(0)
  })
})

describe('the presenter leaving', () => {
  test('keeps the last slide, says the presenter is away, and goes on when they return', async () => {
    const dir = project()
    const here = present(dir)
    const stream = await follow(`/audience/${here.key()}/events`)
    moveTalk(dir, 'd', 1, false)
    await stream.until((events) => states(events).at(-1)?.index === 1)

    here.stop()
    const away = states(await stream.until((events) => states(events).at(-1)?.presenter === false)).at(-1)!
    /* The slide is still there to show. */
    expect(away).toMatchObject({ presenter: false, index: 1, slide: { body: '## Two\n- second' } })

    const back = present(dir)
    expect(back.key()).toBe(here.key())
    expect(states(await stream.until((events) => states(events).at(-1)?.presenter === true)).at(-1)).toMatchObject({ presenter: true, index: 1 })
    stream.close()
  })

  test('a window that only reloads is not said to have gone', async () => {
    AWAY.graceMs = 200
    const dir = project()
    const here = present(dir)
    const stream = await follow(`/audience/${here.key()}/events`)
    await stream.until((events) => events.length > 0)
    here.stop()
    await settle(40)
    present(dir)
    await settle(300)
    expect(states(stream.events).every((state) => state.presenter)).toBe(true)
    stream.close()
  })

  test('away for too long, the link is over: its windows are told and it stops working', async () => {
    AWAY.endsMs = 40
    const dir = project()
    const here = present(dir)
    const key = here.key()
    const stream = await follow(`/audience/${key}/events`)
    await stream.until((events) => events.length > 0)
    here.stop()
    await stream.until((events) => events.some((event) => 'ended' in event && event.ended))
    expect(stream.events.at(-1)).toEqual({ ended: true, why: 'over' })
    expect((await ask(`/audience/${key}`))!.status).toBe(404)
    expect(working(key)).toBe(false)
    await settle()
    expect(stream.over()).toBe(true)
  })
})

describe('who is let in', () => {
  test('a key that was never made, one that is the wrong shape, and none are refused alike', async () => {
    present(project())
    for (const bad of ['x'.repeat(32), 'short', '..%2F..', 'k'.repeat(31), 'k'.repeat(33)]) {
      for (const tail of ['', '/events', '/alive', '/asset?path=a.png']) {
        const response = (await ask(`/audience/${bad}${tail}`))!
        expect(response, `${bad}${tail}`).toBeDefined()
        expect(response.status).toBe(404)
        expect(await response.text()).toContain('not active')
      }
    }
  })

  test('a new link ends the old one: its page and stream are refused, its open windows are told', async () => {
    const dir = project()
    const here = present(dir)
    const old = here.key()
    const stream = await follow(`/audience/${old}/events`)
    await stream.until((events) => events.length > 0)
    const made = renew(dir, 'd')
    expect(made.path).not.toContain(old)
    await stream.until((events) => events.some((event) => 'ended' in event))
    expect(stream.events.at(-1)).toEqual({ ended: true, why: 'renewed' })
    for (const tail of ['', '/events', '/alive']) expect((await ask(`/audience/${old}${tail}`))!.status).toBe(404)
    expect((await ask(`${made.path}/alive`))!.status).toBe(200)
    /* The presenter's window is handed the new one, and the audience is told the presenter is still there. */
    expect(here.links.at(-1)!.path).toBe(made.path)
    expect(linksAlive()).toBe(1)
  })

  test('the page’s ticketed door makes a new link, and a request without the ticket does not', async () => {
    const dir = project()
    const here = present(dir)
    const old = here.key()
    const body = { project: dir, slug: 'd' }
    expect((await answer('POST', '/api/audience', new URLSearchParams(), body, null))!.status).toBe(403)
    expect(working(old)).toBe(true)
    const reply = (await answer('POST', '/api/audience', new URLSearchParams(), body, TICKET))!
    expect(reply.status).toBe(200)
    expect(working(old)).toBe(false)
    expect(working((reply.body as { link: AudienceLink }).link.path.split('/').at(-1)!)).toBe(true)
  })

  test('a page on another site is refused, whoever holds the key', async () => {
    const { key } = present(project())
    for (const tail of ['', '/events', '/alive']) {
      const response = await ask(`/audience/${key()}${tail}`, { sent: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', origin: 'https://example.com' } })
      expect(response!.status, tail).toBe(403)
      /* And a page that says it is from another origin, with no fetch metadata at all. */
      expect((await ask(`/audience/${key()}${tail}`, { sent: { origin: 'https://example.com', host: '127.0.0.1:7990' } }))!.status, tail).toBe(403)
    }
  })

  test('is not reached by paths that are not its own', async () => {
    expect(await ask('/audience')).toBeUndefined()
    expect(await ask('/audience/')).toBeUndefined()
    expect(await ask('/api/audience/x')).toBeUndefined()
  })
})

describe('the read-only door', () => {
  test('takes nothing: every method but GET and HEAD is refused, and nothing moves', async () => {
    const dir = project()
    const { key } = present(dir)
    moveTalk(dir, 'd', 1, false)
    const stream = await follow(`/audience/${key()}/events`)
    await stream.until((events) => events.length > 0)
    const before = stream.events.length
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const tail of ['', '/events', '/alive', '/asset']) {
        const response = (await ask(`/audience/${key()}${tail}`, { method, body: JSON.stringify({ index: 2, blank: true }), headers: { 'content-type': 'application/json' }, sent: { 'sec-fetch-site': 'same-origin' } }))!
        expect(response.status, `${method} ${tail}`).toBe(405)
        expect(response.headers.get('allow')).toBe('GET, HEAD')
      }
    }
    await settle(50)
    expect(stream.events.length).toBe(before)
    expect(states(stream.events).at(-1)).toMatchObject({ index: 1, blank: false })
    /* Nor does a GET dressed up as a write. */
    await ask(`/audience/${key()}/alive?index=2&blank=1&slide=3`)
    await settle(50)
    expect(stream.events.length).toBe(before)
    stream.close()
  })

  test('is not the presenter’s door: it holds no ticket and the page it serves holds none', async () => {
    const { key } = present(project())
    const response = (await ask(`/audience/${key()}`))!
    expect(await response.text()).not.toContain(TICKET)
    /* And the doors under /api/ do not take a key in its place. */
    const talk = await answer('POST', '/api/present', new URLSearchParams(), { project: home, slug: 'd', index: 2 }, key())
    expect(talk!.status).toBe(403)
  })
})

describe('pictures', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

  test('a slide’s picture is served under the key, from the project, and nothing else is', async () => {
    const dir = project()
    writeFileSync(join(dir, 'fig.png'), PNG)
    writeFileSync(join(dir, 'secret.txt'), 'no')
    const { key } = present(dir)
    const ok = (await ask(`/audience/${key()}/asset?path=fig.png`))!
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    expect(ok.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    for (const path of ['secret.txt', '../fig.png', '/etc/passwd', '.kehikot/slides/d.md', '']) {
      expect((await ask(`/audience/${key()}/asset?path=${encodeURIComponent(path)}`))!.status, path).toBe(404)
    }
  })
})
