import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DeckChange, PointerState, PresentState } from '../deck/api.ts'
import { TICKET, deckStreams as stream } from '../doors.ts'
import { POINTER, SETTLE_MS, followPointer, followTalk, moveTalk, pointAt, poke, watchDecks } from '../live.ts'
import { createDeck } from '../store.ts'
import { answer } from './now.ts'
import { hostThat, holdsEveryFolder, noHost } from './host.ts'

/**
 * A project folder that is renamed while this module is running (protocol 2.3.0). Nothing is written
 * under a path the host does not vouch for; a former path is followed to where the project is now; what
 * the server keeps for a talk, a pointing and a watch is kept by the project, not its folder.
 * The host is a table (`test/host.ts`), the folders are scratch ones.
 */

const base = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-slides-moved-')))
const waited = POINTER.waitMs
afterEach(() => holdsEveryFolder())
afterAll(() => {
  POINTER.waitMs = waited
  holdsEveryFolder()
  rmSync(base, { recursive: true, force: true })
})

/* Every project is its own, with an id of its own: what the server keeps is kept by it. */
let n = 0
const ids = new Map<string, string>()
const idFor = (k: number) => `a1b2c3d4-0000-4000-8000-${String(k).padStart(12, '0')}`
function project(withId = true): string {
  n += 1
  const dir = join(base, `p${n}`)
  mkdirSync(join(dir, '.kehikot'), { recursive: true })
  if (withId) {
    ids.set(dir, idFor(n))
    writeFileSync(join(dir, '.kehikot', 'project.json'), JSON.stringify({ id: idFor(n), createdAt: null }))
  }
  return dir
}
const idOf = (dir: string): string => ids.get(dir) ?? ''
const renamed = (was: string): string => {
  const now = `${was}-renamed`
  renameSync(was, now)
  ids.set(now, idOf(was))
  return now
}
const slidesIn = (dir: string) => join(dir, '.kehikot', 'slides')
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

const none = new URLSearchParams()
async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
  const result = (reply?.body as { result?: { content?: { text: string }[]; isError?: boolean } }).result
  return { text: result?.content?.[0]?.text ?? '', error: result?.isError === true }
}
const make = (dir: string) => tool('create_deck', { project: dir, title: 'Deck' })

describe('a former path is followed, and nothing is written under a stale one', () => {
  test('an agent’s write at the old path lands in the project where it is now, and says so', async () => {
    const was = project()
    const now = renamed(was)
    hostThat({ [now]: idOf(now) }, { [was]: now })
    const made = await make(was)
    expect(made.error).toBe(false)
    expect(made.text).toContain(`The project at ${was} has moved to ${now}`)
    expect(existsSync(join(slidesIn(now), 'deck.md'))).toBe(true)
    expect(existsSync(was)).toBe(false)
  })

  test('the page’s write at the old path is followed too', async () => {
    const was = project()
    const now = renamed(was)
    hostThat({ [now]: idOf(now) }, { [was]: now })
    const reply = await answer('POST', '/api/decks', none, { project: was, title: 'Deck' }, TICKET)
    expect(reply?.status).toBe(200)
    expect(existsSync(join(slidesIn(now), 'deck.md'))).toBe(true)
    expect(existsSync(was)).toBe(false)
  })

  test('an unrelated folder at the old path is refused, and nothing is written in it', async () => {
    const stranger = project(false)
    const elsewhere = project()
    /* The host says that path moved to a folder that does not answer as the same project. */
    hostThat({ [elsewhere]: idOf(elsewhere) }, { [stranger]: { to: elsewhere, id: idFor(9999) } })
    const made = await make(stranger)
    expect(made).toEqual({ text: `That folder was moved to ${elsewhere}; use that path.`, error: true })
    const reply = await answer('POST', '/api/decks', none, { project: stranger, title: 'Deck' }, TICKET)
    expect(reply?.status).toBe(404)
    expect(existsSync(slidesIn(stranger))).toBe(false)
    expect(existsSync(slidesIn(elsewhere))).toBe(false)
  })

  test('a folder the host does not hold is refused in the shared sentence, and nothing is written', async () => {
    const dir = project()
    hostThat({})
    expect(await make(dir)).toEqual({ text: `${dir} is not a project open in Kehikot.`, error: true })
    expect(existsSync(slidesIn(dir))).toBe(false)
  })

  test('with no host answering, the tools and the page’s doors refuse and nothing is written', async () => {
    const dir = project()
    noHost()
    expect(await make(dir)).toEqual({ text: `${dir} is not a project open in Kehikot.`, error: true })
    expect((await tool('list_decks', { project: dir })).error).toBe(true)
    expect((await tool('show_slide', { project: dir, deck: 'd', index: 0 })).error).toBe(true)
    for (const [method, path, body] of [['POST', '/api/decks', { project: dir, title: 'Deck' }], ['PUT', '/api/deck', { project: dir, slug: 'd', text: 'x' }]] as const) {
      expect((await answer(method, path, none, body, TICKET))?.status).toBe(404)
    }
    expect((await answer('GET', '/api/decks', new URLSearchParams({ project: dir }), null, TICKET))?.status).toBe(404)
    expect(existsSync(slidesIn(dir))).toBe(false)
  })
})

describe('a window of its own asks where the project is now', () => {
  const where = async (project: string, projectId?: string) =>
    answer('GET', '/api/where', new URLSearchParams(projectId ? { project, projectId } : { project }), null, TICKET)

  test('a renamed folder is followed, and the answer is the new path', async () => {
    const was = project()
    const now = renamed(was)
    hostThat({ [now]: idOf(now) }, { [was]: now })
    const reply = await where(was, idOf(now))
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ project: now, id: idOf(now), movedFrom: was })
  })

  test('a folder that is now another project is refused', async () => {
    const dir = project()
    hostThat({ [dir]: idOf(dir) })
    /* The window was opened on another project's id. */
    const reply = await where(dir, idFor(9999))
    expect(reply?.status).toBe(404)
    expect((reply?.body as { error: string }).error).toBe(`${dir} is not a project open in Kehikot.`)
  })

  test('it asks for the page’s ticket, like every other door', async () => {
    const dir = project()
    expect((await answer('GET', '/api/where', new URLSearchParams({ project: dir }), null, null))?.status).toBe(403)
  })
})

describe('what the server keeps is kept by the project, not its folder', () => {
  test('a talk moved at the old path is the talk followed at the new one', () => {
    const was = project()
    moveTalk(was, 'talk', 3, false)
    const now = renamed(was)
    const seen: PresentState[] = []
    const off = followTalk(now, 'talk', (state) => seen.push(state))
    expect(seen).toMatchObject([{ index: 3, blank: false }])
    moveTalk(now, 'talk', 4, true)
    expect(seen).toMatchObject([{ index: 3 }, { index: 4, blank: true }])
    off()
  })

  test('a pointing made at the new path reaches a page that opened on the old one', async () => {
    const was = project()
    const told: PointerState[] = []
    const off = followPointer(was, 'deck', (state) => told.push(state))
    const now = renamed(was)
    POINTER.waitMs = 20
    const pointing = pointAt(now, 'deck', 2)
    expect(pointing.watching).toBe(1)
    expect(told.at(-1)).toMatchObject({ index: 2 })
    off()
    await pointing.heard /* no page said anything: settles at POINTER.waitMs */
  })

  test('a stream opened at the old path before the rename keeps its talk', async () => {
    const was = project()
    const seen: unknown[] = []
    const open = stream('GET', '/api/present', new URLSearchParams({ project: was, slug: 'talk' }), (event) => seen.push(event))
    await wait()
    const now = renamed(was)
    hostThat({ [now]: idOf(now) }, { [was]: now })
    expect((await answer('POST', '/api/present', none, { project: was, slug: 'talk', index: 2 }, TICKET))?.status).toBe(200)
    expect(seen).toMatchObject([{ index: 0 }, { index: 2 }])
    if (open && 'close' in open) open.close()
  })

  test('a watch on a folder that is renamed is the same watch: it is pointed at the new folder and reports only real changes', async () => {
    const was = project()
    createDeck(was, 'Deck')
    const seen: DeckChange[] = []
    const watched = watchDecks(was, (change) => seen.push(change))
    if (!watched.ok) throw new Error(watched.error)
    const now = renamed(was)
    await wait(SETTLE_MS * 4)
    /* The folder is gone from where the watch was; that is not every deck being deleted. */
    expect(seen).toEqual([])

    poke(now)
    await wait(SETTLE_MS * 4)
    expect(seen).toEqual([])
    writeFileSync(join(slidesIn(now), 'deck.md'), '# by hand\n')
    await wait(SETTLE_MS * 4)
    expect(seen.map((change) => change.slug)).toEqual(['deck'])
    watched.value()
  })
})
