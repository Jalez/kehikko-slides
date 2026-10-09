import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { AskFailed, resetServerStanding, serverStanding } from 'kehikot-module-protocol/client'

import { TICKET, answer } from '../doors.ts'
import { decks } from '../src/wire/decks.ts'

/* The page's wire against the real doors, with `fetch` as the only thing faked. */
const realFetch = globalThis.fetch
let reply: (url: string, init: RequestInit) => Response | Promise<Response>
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  resetServerStanding()
  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify(TICKET)
  document.body.appendChild(island)
  globalThis.fetch = ((url: string, init: RequestInit = {}) => Promise.resolve(reply(url, init))) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
})

describe('the decks wire', () => {
  test('a write carries the page’s ticket, which the doors accept', async () => {
    let carried = ''
    reply = (_url, init) => {
      carried = (init.headers as Record<string, string>)['x-module-ticket'] ?? ''
      const said = answer('POST', '/api/decks', new URLSearchParams(), JSON.parse(String(init.body)), carried)
      return json(said?.status ?? 500, said?.body)
    }
    /* No such project: the doors refuse in their own words, and it is not the ticket they refuse. */
    await expect(decks.create('/nowhere/at/all', 'A deck')).rejects.toThrow()
    expect(carried).toBe(TICKET)
    expect(serverStanding()).toBe('up')
  })

  test('a page older than its server: the refusal is marked, and the wire says so', async () => {
    reply = (_url, init) => {
      const said = answer('POST', '/api/decks', new URLSearchParams(), JSON.parse(String(init.body)), 'a-ticket-from-before-the-restart')
      return json(said?.status ?? 500, said?.body)
    }
    const failed = await decks.create('/p', 'A deck').catch((caught: unknown) => caught)
    expect(failed).toBeInstanceOf(AskFailed)
    expect((failed as AskFailed).kind).toBe('stale')
    expect((failed as AskFailed).message).toContain('older than its server')
    expect(serverStanding()).toBe('stale')
  })

  test('the server not answering is one sentence, not "Failed to fetch"', async () => {
    reply = () => {
      throw new TypeError('Failed to fetch')
    }
    const failed = await decks.list('/p').catch((caught: unknown) => caught)
    expect((failed as Error).message).toBe('This app’s own server is not answering.')
    expect(serverStanding()).toBe('down')
  })

  test('a save somebody else got to first comes back as a conflict, not a failure', async () => {
    reply = () => json(409, { ok: false, error: 'changed elsewhere', version: 'v9', text: 'theirs' })
    expect(await decks.save('/p', 'deck', 'mine', 'v1')).toEqual({ ok: false, conflict: { version: 'v9', text: 'theirs' } })
  })

  test('a refusal is thrown in the server’s own words', async () => {
    reply = () => json(400, { ok: false, error: 'A deck needs a title.' })
    await expect(decks.retitle('/p', 'deck', '')).rejects.toThrow('A deck needs a title.')
  })
})
