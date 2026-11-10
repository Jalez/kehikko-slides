import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer } from './now.ts'
import { TICKET } from '../doors.ts'
import { createDeck, history, readDeck, writeDeck } from '../store.ts'

/**
 * Proposed changes to a deck (protocol 2.71.0): an agent proposes over the door,
 * the page lists and answers, an accepted one is written to the deck through the
 * history (so it can be undone), a declined one keeps the reason for the agent.
 */

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-proposals-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
const q = (query: Record<string, string>) => new URLSearchParams(query)

async function tool(name: string, args: Record<string, unknown>): Promise<string> {
  const reply = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
  return (reply?.body as { result: { content: { text: string }[] } }).result.content[0]!.text
}

describe('proposed changes to a deck', () => {
  test('an agent proposes, the page sees it, the person accepts it, and the deck is written through the history', async () => {
    const dir = project('accepts')
    const made = createDeck(dir, 'Defence')
    if (!made.ok) throw new Error(made.error)
    writeDeck(dir, made.value.slug, '---\ntitle: Defence\n---\n\n# The problem\n- one\n')
    const filed = await tool('propose_change', { project: dir, deck: made.value.slug, find: '- one', replace: '- one, stated plainly', why: 'Say it.', agent: 'claude' })
    expect(filed).toMatch(/^Filed as p-/)
    const id = /Filed as (p-[0-9a-f]+)/.exec(filed)![1]!
    expect(existsSync(join(dir, '.kehikot/slides/proposals/all.json'))).toBe(true)

    const listed = await answer('GET', '/api/proposals', q({ project: dir, slug: made.value.slug }), null, TICKET)
    const body = listed?.body as { proposals: { id: string; status: string; by: { name: string } }[] }
    expect(body.proposals.map((one) => [one.id, one.status, one.by.name])).toEqual([[id, 'pending', 'claude']])

    const accepted = await answer('POST', '/api/proposal', new URLSearchParams(), { project: dir, id, decision: 'accept' }, TICKET)
    expect(accepted?.status).toBe(200)
    const deck = readDeck(dir, made.value.slug)
    expect(deck.ok && deck.value.text).toContain('- one, stated plainly')
    const trail = history(dir, made.value.slug)
    expect(trail.ok && trail.value[0]?.summary).toBe('accepted a proposal by claude: Say it.')
    expect(await tool('list_proposals', { project: dir, deck: made.value.slug })).toContain('state: accepted')
  })

  test('declined with a reason the agent reads; stale when the deck moved under it', async () => {
    const dir = project('declines')
    const made = createDeck(dir, 'Talk')
    if (!made.ok) throw new Error(made.error)
    writeDeck(dir, made.value.slug, '---\ntitle: Talk\n---\n\n# One\n- alpha\n')
    const filed = await tool('propose_change', { project: dir, deck: made.value.slug, find: '- alpha', replace: '- beta', why: 'Greek.' })
    const id = /Filed as (p-[0-9a-f]+)/.exec(filed)![1]!
    const declined = await answer('POST', '/api/proposal', new URLSearchParams(), { project: dir, id, decision: 'decline', reason: 'Alpha is right.' }, TICKET)
    expect(declined?.status).toBe(200)
    expect(await tool('read_proposal', { project: dir, id })).toContain('Declined reason: Alpha is right.')
    const deck = readDeck(dir, made.value.slug)
    expect(deck.ok && deck.value.text).toContain('- alpha')

    const again = await tool('propose_change', { project: dir, deck: made.value.slug, find: '- alpha', replace: '- gamma', why: 'Greek.' })
    const second = /Filed as (p-[0-9a-f]+)/.exec(again)![1]!
    writeDeck(dir, made.value.slug, '---\ntitle: Talk\n---\n\n# One\n- omega\n')
    const listed = await answer('GET', '/api/proposals', q({ project: dir, slug: made.value.slug }), null, TICKET)
    expect((listed?.body as { proposals: { id: string; status: string }[] }).proposals).toEqual([expect.objectContaining({ id: second, status: 'stale' })])
    const refused = await answer('POST', '/api/proposal', new URLSearchParams(), { project: dir, id: second, decision: 'accept' }, TICKET)
    expect(refused?.status).toBe(409)
    expect(readFileSync(join(dir, '.kehikot/slides', `${made.value.slug}.md`), 'utf8')).toContain('- omega')
  })

  test('the page’s doors take the ticket', async () => {
    const dir = project('ticket')
    expect((await answer('GET', '/api/proposals', q({ project: dir, slug: 'x' }), null, null))?.status).toBe(403)
  })
})
