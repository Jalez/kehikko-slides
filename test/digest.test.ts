import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DIGEST_QUIET_MS } from 'kehikot-module-protocol/proposals'

import { answer } from './now.ts'
import { resetDigester, setTeller } from '../digest.ts'
import { TICKET } from '../doors.ts'
import { MANIFEST } from '../manifest.ts'
import { createDeck, writeDeck } from '../store.ts'

/**
 * The follow-up digest (protocol 2.75.0): the session that proposed changes to
 * a deck hears ONCE what the person made of them, when every one of its
 * proposals there is answered and nothing more was decided for the quiet
 * while — never a message per decision. The reasons for what was declined are
 * in it.
 */

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-digest-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123'
let told: { project: string; token: string; body: string }[] = []

/** Timers the test moves by hand: the quiet while without waiting 30 s. */
function fakeClock() {
  let now = 0
  let timers: { run: () => void; at: number }[] = []
  return {
    setTimer: (run: () => void, ms: number) => {
      const timer = { run, at: now + ms }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer: unknown) => {
      timers = timers.filter((one) => one !== timer)
    },
    advance(ms: number) {
      now += ms
      for (const timer of timers.filter((one) => one.at <= now)) {
        timers = timers.filter((one) => one !== timer)
        timer.run()
      }
    },
    waiting: () => timers.length,
  }
}
let clock = fakeClock()

beforeEach(() => {
  told = []
  setTeller((project, token, body) => told.push({ project, token, body }))
  clock = fakeClock()
  resetDigester(clock)
})
afterEach(() => {
  setTeller(null)
  resetDigester()
})

let n = 0
function deck(): { dir: string; slug: string } {
  const dir = join(home, `p${++n}`)
  mkdirSync(dir, { recursive: true })
  const made = createDeck(dir, 'Talk')
  if (!made.ok) throw new Error(made.error)
  writeDeck(dir, made.value.slug, '---\ntitle: Talk\n---\n\n# One\n- alpha\n- beta\n- gamma\n')
  return { dir, slug: made.value.slug }
}

async function propose(at: { dir: string; slug: string }, find: string, replace: string, token: string | null = TOKEN): Promise<string> {
  const query = new URLSearchParams(token ? { 'kehikot-place': token } : {})
  const args = { project: at.dir, deck: at.slug, find, replace, why: 'Better.', agent: 'claude' }
  const reply = await answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_change', arguments: args } }, null)
  const said = (reply?.body as { result: { content: { text: string }[] } }).result.content[0]!.text
  return /Filed as (p-[0-9a-f]+)/.exec(said)![1]!
}

const decide = (at: { dir: string }, id: string, decision: 'accept' | 'decline', reason?: string) =>
  answer('POST', '/api/proposal', new URLSearchParams(), { project: at.dir, id, decision, ...(reason ? { reason } : {}) }, TICKET)

describe('the follow-up digest', () => {
  test('answered all: one digest after the quiet while, to the token the proposal came with', async () => {
    const at = deck()
    const a = await propose(at, '- alpha', '- Alpha')
    const b = await propose(at, '- beta', '- Beta')
    expect((await decide(at, a, 'accept'))?.status).toBe(200)
    expect(clock.waiting()).toBe(0)
    await decide(at, b, 'decline', 'Beta stays lower case.')
    expect(told).toEqual([])
    clock.advance(DIGEST_QUIET_MS - 1)
    expect(told).toEqual([])
    clock.advance(1)
    expect(told).toHaveLength(1)
    expect(told[0]!.token).toBe(TOKEN)
    expect(told[0]!.project).toBe(at.dir)
    expect(told[0]!.body).toBe(
      `Your 2 proposed changes to ${at.slug} were answered: 1 accepted, 1 declined: "Beta stays lower case.". list_proposals shows each one.`,
    )
  })

  test('no message per decision: one answered of two says nothing while the other is open', async () => {
    const at = deck()
    const a = await propose(at, '- alpha', '- Alpha')
    await propose(at, '- beta', '- Beta')
    await decide(at, a, 'decline', 'No.')
    clock.advance(DIGEST_QUIET_MS * 10)
    expect(told).toEqual([])
  })

  test('a decision in the quiet while starts it again, and every declined reason is said', async () => {
    const at = deck()
    const a = await propose(at, '- alpha', '- Alpha')
    await decide(at, a, 'decline', 'First.')
    clock.advance(DIGEST_QUIET_MS - 1000)
    const b = await propose(at, '- gamma', '- Gamma')
    await decide(at, b, 'decline', 'Second.')
    clock.advance(DIGEST_QUIET_MS - 1000)
    expect(told).toEqual([])
    clock.advance(1000)
    expect(told.map((one) => one.body)).toEqual([
      `Your 2 proposed changes to ${at.slug} were answered: 2 declined: "First."; "Second.". list_proposals shows each one.`,
    ])
  })

  test('a proposal filed without a place token is told nothing', async () => {
    const at = deck()
    const a = await propose(at, '- alpha', '- Alpha', null)
    await decide(at, a, 'decline', 'No.')
    clock.advance(DIGEST_QUIET_MS)
    expect(told).toEqual([])
  })

  test('the manifest declares agents:message, which messages.notify is filed under', () => {
    expect(MANIFEST.declares.uses).toContain('agents:message')
  })
})
