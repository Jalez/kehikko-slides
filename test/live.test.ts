import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DeckChange } from '../deck/api.ts'
import { TICKET, answer, stream } from '../doors.ts'
import { SETTLE_MS, watchDecks, watching } from '../live.ts'
import { createDeck, versionOf } from '../store.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-live-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 4))

describe('watching decks', () => {
  test('a write through the API is told to every watcher, once, with its version', async () => {
    const dir = project('api')
    createDeck(dir, 'Deck')
    const seen: DeckChange[] = []
    const open = stream('GET', '/api/watch', new URLSearchParams({ project: dir }), (e) => seen.push(e as DeckChange))
    if (!open || !('close' in open)) throw new Error('the watch did not open')

    const reply = answer('PUT', '/api/deck', new URLSearchParams(), { project: dir, slug: 'deck', text: '# new\n' }, TICKET)
    await settle()
    expect(seen).toEqual([{ slug: 'deck', version: (reply?.body as { version: string }).version }])
    open.close()
    expect(watching()).toBe(0)
  })

  test('a person editing the file on disk, and a deck going away, are told too', async () => {
    const dir = project('disk')
    createDeck(dir, 'Deck')
    const seen: DeckChange[] = []
    const stop = watchDecks(dir, (e) => seen.push(e))
    if (!stop.ok) throw new Error(stop.error)

    writeFileSync(join(dir, '.kehikot', 'slides', 'deck.md'), '# by hand\n')
    writeFileSync(join(dir, '.kehikot', 'slides', 'notes.txt'), 'not a deck')
    await settle()
    expect(seen).toEqual([{ slug: 'deck', version: versionOf('# by hand\n') }])

    rmSync(join(dir, '.kehikot', 'slides', 'deck.md'))
    await settle()
    expect(seen.at(-1)).toEqual({ slug: 'deck', version: null })
    stop.value()
  })

  test('a project with no slides folder yet can be watched without one being made', () => {
    const dir = project('empty')
    const stop = watchDecks(dir, () => {})
    if (!stop.ok) throw new Error(stop.error)
    stop.value()
    expect(watching()).toBe(0)
    expect(watchDecks('relative', () => {}).ok).toBe(false)
  })
})
