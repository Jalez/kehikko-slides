import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { watching } from 'kehikot-module-protocol/serve'

import { TICKET, stream } from '../doors.ts'
import { CITED_EVENTS_PATH, CITED_NEWS, citedTopic, citedWatched, stopCiting } from '../live.ts'
import { answer } from './now.ts'

/**
 * An open deck is told when a file its slides cite changes, so it looks for its citations again
 * without asking on a clock. The doors' stream, called as the doors call it, with an `emit` that
 * collects; the citations door says which files are watched.
 */

const home = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-slides-cited-')))
afterAll(() => rmSync(home, { recursive: true, force: true }))
afterEach(() => stopCiting())

const none = new URLSearchParams()
/* Longer than the settling (50 ms) and a file event's arrival. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250))
const CHAPTER = 'Intro.\n\nThe mean rating was highest after the\nvanilla-JavaScript module (3.51).\n'

async function tool(name: string, args: Record<string, unknown>) {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
  return reply?.body as { result?: { isError?: boolean } }
}

async function citedDeck(name: string): Promise<string> {
  const dir = join(home, name)
  mkdirSync(join(dir, 'ch'), { recursive: true })
  writeFileSync(join(dir, 'ch/4.tex'), CHAPTER)
  writeFileSync(join(dir, 'ch/5.tex'), 'Not cited.\n')
  await tool('create_deck', { project: dir, title: 'D' })
  await tool('write_deck', { project: dir, deck: 'd', markdown: '# One\n- Mean 3.51 after vanilla\n', summary: 'draft' })
  expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'highest after the', agent: 'claude' }))?.result?.isError).toBeFalsy()
  return dir
}

const read = (dir: string) => answer('GET', '/api/citations', new URLSearchParams({ project: dir, slug: 'd' }), null, TICKET)

function open(dir: string) {
  const heard: unknown[] = []
  const live = stream('GET', CITED_EVENTS_PATH, new URLSearchParams({ project: dir, slug: 'd' }), (event) => heard.push(event), null)
  if (!live || !('close' in live)) throw new Error('the citations stream did not open')
  return { heard, close: live.close }
}

describe('the cited files stream', () => {
  test('opens with the news once; a cited file edited is news, a file not cited is not', async () => {
    const dir = await citedDeck('edits')
    const { heard, close } = open(dir)
    expect(heard).toEqual([CITED_NEWS])
    expect(watching(citedTopic(dir, 'd'))).toBe(1)

    /* The page reads the citations as the stream opens: that names the files to watch. */
    expect((await read(dir))?.status).toBe(200)
    expect(citedWatched()).toBe(1)

    writeFileSync(join(dir, 'ch/5.tex'), 'Still not cited.\n')
    await settle()
    expect(heard.length).toBe(1)

    writeFileSync(join(dir, 'ch/4.tex'), CHAPTER.replace('highest', 'lowest'))
    await settle()
    expect(heard).toEqual([CITED_NEWS, CITED_NEWS])

    /* Saved by renaming over it, as many editors do. */
    writeFileSync(join(dir, 'ch/4.tex.tmp'), CHAPTER)
    const { renameSync } = await import('node:fs')
    renameSync(join(dir, 'ch/4.tex.tmp'), join(dir, 'ch/4.tex'))
    await settle()
    expect(heard.length).toBe(3)

    close()
    expect(watching(citedTopic(dir, 'd'))).toBe(0)
    /* Let go of at the next event, or the next read, once nobody follows. */
    writeFileSync(join(dir, 'ch/4.tex'), CHAPTER)
    await settle()
    expect(citedWatched()).toBe(0)
  })

  test('nobody following: the citations door watches nothing; a bad slug or no project is not this stream', async () => {
    const dir = await citedDeck('nobody')
    expect((await read(dir))?.status).toBe(200)
    expect(citedWatched()).toBe(0)
    expect(stream('GET', CITED_EVENTS_PATH, new URLSearchParams({ project: dir, slug: '../x' }), () => {}, null)).toBeNull()
    expect(stream('GET', CITED_EVENTS_PATH, new URLSearchParams({ slug: 'd' }), () => {}, null)).toBeNull()
  })
})
