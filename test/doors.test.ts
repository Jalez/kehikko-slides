import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WELL_KNOWN } from 'kehikot-module-protocol'

import { parseDeck } from '../deck/format.ts'
import { MANIFEST, PICTURE_HEADERS, TICKET, deckStreams as stream } from '../doors.ts'
import { answer } from './now.ts'
import { ID } from '../manifest.ts'
import { createDeck, history, readDeck } from '../store.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-doors-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

const none = new URLSearchParams()
const q = (query: Record<string, string>) => new URLSearchParams(query)

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method, params }, null)
  return reply?.body as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean } }
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const result = (await rpc('tools/call', { name, arguments: args })).result
  return { text: result?.content?.[0]?.text ?? '', error: result?.isError === true }
}

const DECK = `---
title: Defence
---

<!-- layout: title -->
# Bridging the gap

---

## The problem
- one

---

## The end
`

describe('the doors', () => {
  test('the health check says which module this is', async () => {
    const reply = (await answer('GET', '/healthz', none, null, null))
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe(ID)
  })

  test('the manifest is served at the well-known path by the config, and is this module’s', async () => {
    expect(WELL_KNOWN.startsWith('/')).toBe(true)
    expect(MANIFEST.id).toBe(ID)
  })

  test('a path that is not ours is left to Vite, and an unknown /api path is refused', async () => {
    expect((await answer('GET', '/src/main.tsx', none, null, null))).toBeNull()
    expect((await answer('GET', '/api/nothing', none, null, TICKET))?.status).toBe(404)
  })
})

describe('the HTTP api', () => {
  test('every door under /api needs this page’s ticket, the reads with the writes', async () => {
    const dir = project('ticket')
    const writes: [string, string, Record<string, unknown>][] = [
      ['POST', '/api/decks', { project: dir, title: 'T' }],
      ['PUT', '/api/deck', { project: dir, slug: 't', text: 'x' }],
      ['PATCH', '/api/deck', { project: dir, slug: 't', title: 'U' }],
      ['DELETE', '/api/deck', { project: dir, slug: 't' }],
      ['POST', '/api/undo', { project: dir, slug: 't', id: 'x' }],
      ['POST', '/api/present', { project: dir, slug: 't', index: 0 }],
    ]
    for (const [method, path, body] of writes) {
      expect((await answer(method, path, none, body, null))?.status).toBe(403)
      expect((await answer(method, path, none, body, 'not-the-ticket'))?.status).toBe(403)
    }
    const reads: [string, Record<string, string>][] = [
      ['/api/decks', { project: dir }],
      ['/api/deck', { project: dir, slug: 't' }],
      ['/api/history', { project: dir, slug: 't' }],
      ['/api/citations', { project: dir, slug: 't' }],
      ['/api/source', { project: dir, path: 'a.tex', from: '0', to: '1' }],
      ['/api/nothing', {}],
    ]
    for (const [path, query] of reads) {
      for (const carried of [null, 'not-the-ticket']) {
        const reply = (await answer('GET', path, q(query), null, carried))
        expect([path, reply?.status]).toEqual([path, 403])
        expect((reply?.body as { refused?: string }).refused).toBe('ticket')
      }
    }
    expect((await answer('GET', '/api/decks', q({ project: dir }), null, TICKET))?.status).toBe(200)
  })

  test('create, read, save, conflict, retitle, delete', async () => {
    const dir = project('crud')
    const created = (await answer('POST', '/api/decks', none, { project: dir, title: 'My talk', epic: 'e' }, TICKET))
    expect(created?.body).toMatchObject({ ok: true, slug: 'my-talk' })

    const read = (await answer('GET', '/api/deck', q({ project: dir, slug: 'my-talk' }), null, TICKET))?.body as { version: string; text: string }
    expect(read.text).toContain('title: My talk')

    const saved = (await answer('PUT', '/api/deck', none, { project: dir, slug: 'my-talk', text: DECK, base: read.version }, TICKET))
    expect(saved?.status).toBe(200)
    const stale = (await answer('PUT', '/api/deck', none, { project: dir, slug: 'my-talk', text: 'x', base: read.version }, TICKET))
    expect(stale?.status).toBe(409)
    expect(stale?.body).toMatchObject({ ok: false, text: DECK, version: (saved?.body as { version: string }).version })
    expect(typeof (stale?.body as { error: string }).error).toBe('string')

    expect((await answer('PATCH', '/api/deck', none, { project: dir, slug: 'my-talk', title: 'Renamed' }, TICKET))?.status).toBe(200)
    const list = (await answer('GET', '/api/decks', q({ project: dir }), null, TICKET))?.body as { decks: unknown[] }
    expect(list.decks).toMatchObject([{ slug: 'my-talk', title: 'Renamed', slides: 3 }])

    expect((await answer('DELETE', '/api/deck', none, { project: dir, slug: 'my-talk' }, TICKET))?.status).toBe(200)
    expect((await answer('GET', '/api/deck', q({ project: dir, slug: 'my-talk' }), null, TICKET))?.status).toBe(404)
  })

  test('refusals are sentences', async () => {
    const reply = (await answer('GET', '/api/decks', q({ project: 'relative' }), null, TICKET))
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toMatch(/absolute path/)
  })

  test('history and undo of an agent’s write', async () => {
    const dir = project('http-undo')
    await tool('create_deck', { project: dir, title: 'Deck', agent: 'claude' })
    const before = (readDeck(dir, 'deck') as { value: { text: string } }).value.text
    await tool('write_deck', { project: dir, deck: 'deck', markdown: DECK, summary: 'drafted', agent: 'claude' })
    const entries = ((await answer('GET', '/api/history', q({ project: dir, slug: 'deck' }), null, TICKET))?.body as { entries: { id: string; summary: string }[] }).entries
    expect(entries.map((one) => one.summary)).toEqual(['drafted', 'created the deck "Deck"'])
    expect((await answer('POST', '/api/undo', none, { project: dir, slug: 'deck', id: entries[0]!.id }, TICKET))?.status).toBe(200)
    expect((readDeck(dir, 'deck') as { value: { text: string } }).value.text).toBe(before)
  })
})

describe('the MCP door', () => {
  test('lists its tools', async () => {
    expect((await answer('GET', '/mcp', none, null, null))?.status).toBe(405)
    expect((await rpc('tools/list')).result?.tools?.map((one) => one.name)).toEqual([
      'list_decks',
      'read_deck',
      'create_deck',
      'write_deck',
      'edit_slide',
      'link_slide',
      'cite_slide',
      'show_slide',
    ])
  })

  test('every tool says whether it only reads, and which writes replace what was there', async () => {
    const tools = ((await rpc('tools/list')).result?.tools ?? []) as unknown as { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[]
    expect(tools.every((one) => typeof one.annotations?.readOnlyHint === 'boolean' && typeof one.annotations.destructiveHint === 'boolean')).toBe(true)
    expect(tools.filter((one) => one.annotations!.readOnlyHint).map((one) => one.name)).toEqual(['list_decks', 'read_deck', 'show_slide'])
    expect(tools.filter((one) => one.annotations!.destructiveHint).map((one) => one.name)).toEqual(['write_deck', 'edit_slide'])
  })

  test('every write is recorded in the history, under the agent’s name', async () => {
    const dir = project('mcp-writes')
    expect((await tool('create_deck', { project: dir, title: 'Talk', epic: 'thesis', agent: 'claude' })).error).toBe(false)
    expect((await tool('write_deck', { project: dir, deck: 'talk', markdown: DECK, summary: 'draft', agent: 'claude' })).error).toBe(false)
    expect((await tool('edit_slide', { project: dir, deck: 'talk', index: 1, markdown: '## Better', summary: 'tighter', agent: 'claude' })).error).toBe(false)
    expect((await tool('link_slide', { project: dir, deck: 'talk', index: 2, path: 'ch/2.tex', title: 'End', agent: 'claude' })).error).toBe(false)
    const entries = (history(dir, 'talk') as { value: { agent: string; summary: string }[] }).value
    expect(entries.length).toBe(4)
    expect(entries.every((one) => one.agent === 'claude')).toBe(true)
    expect(entries.map((one) => one.summary)).toEqual(['linked slide 2 to "End"', 'tighter', 'draft', 'created the deck "Talk"'])

    /* write_deck replaced the front matter too, and DECK names no epic. */
    expect((await tool('list_decks', { project: dir, epic: 'thesis' })).text).toMatch(/No deck .* belongs to the epic "thesis"/)
    expect((await tool('list_decks', { project: dir })).text).toContain('talk')
  })

  test('edit_slide replaces one slide only', async () => {
    const dir = project('edit')
    await tool('create_deck', { project: dir, title: 'D' })
    await tool('write_deck', { project: dir, deck: 'd', markdown: DECK, summary: 'draft' })
    await tool('edit_slide', { project: dir, deck: 'd', index: 1, markdown: '<!-- layout: quote -->\n> So.\n\nNotes:\nPause.', summary: 'quote' })
    const text = (readDeck(dir, 'd') as { value: { text: string } }).value.text
    expect(text).toBe(DECK.replace('## The problem\n- one', '<!-- layout: quote -->\n> So.\n\nNotes:\nPause.'))
  })

  test('link_slide sets the section and keeps the rest of the slide', async () => {
    const dir = project('link')
    await tool('create_deck', { project: dir, title: 'D' })
    await tool('write_deck', { project: dir, deck: 'd', markdown: DECK, summary: 'draft' })
    expect((await tool('link_slide', { project: dir, deck: 'd', index: 0, path: join(dir, 'chapters/2.tex'), title: 'Bridging the gap' })).error).toBe(false)
    const slide = parseDeck((readDeck(dir, 'd') as { value: { text: string } }).value.text).slides[0]!
    expect(slide.section).toEqual({ path: 'chapters/2.tex', title: 'Bridging the gap' })
    expect(slide.layout).toBe('title')
    expect(slide.body).toBe('# Bridging the gap')
    expect((await tool('read_deck', { project: dir, deck: 'd' })).text).toContain('0. title — Bridging the gap — section: chapters/2.tex | Bridging the gap')
  })

  test('a bad deck, index, path or slide is a clear refusal that writes nothing', async () => {
    const dir = project('bad')
    await tool('create_deck', { project: dir, title: 'D' })
    await tool('write_deck', { project: dir, deck: 'd', markdown: DECK, summary: 'draft' })
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['read_deck', { project: dir, deck: 'nope' }, /no deck "nope".*list_decks/],
      ['read_deck', { project: dir, deck: '../x' }, /not a deck name/],
      ['read_deck', { deck: 'd' }, /needs project/],
      ['edit_slide', { project: dir, deck: 'd', index: 3, markdown: 'x', summary: 's' }, /3 slides, numbered 0 to 2/],
      ['edit_slide', { project: dir, deck: 'd', index: -1, markdown: 'x', summary: 's' }, /numbered 0 to 2/],
      ['edit_slide', { project: dir, deck: 'd', index: 0, markdown: 'a\n---\nb', summary: 's' }, /--- line/],
      ['edit_slide', { project: dir, deck: 'd', index: 0, markdown: 'x' }, /needs a summary/],
      ['edit_slide', { project: dir, deck: 'd', index: 0, markdown: '<!-- layout: wide -->\nx', summary: 's' }, /layout "wide"/],
      ['link_slide', { project: dir, deck: 'd', index: 0, path: '../out.tex', title: 'T' }, /not a file inside this project/],
      ['link_slide', { project: dir, deck: 'd', index: 0, path: 'a.tex', title: 'A; B' }, /cannot hold/],
      ['write_deck', { project: dir, deck: 'nope', markdown: '# x', summary: 's' }, /no deck "nope"/],
      ['nonsense', {}, /no tool/],
    ]
    for (const [name, args, why] of cases) {
      const result = (await tool(name, args))
      expect(result.error).toBe(true)
      expect(result.text).toMatch(why)
    }
    expect((readDeck(dir, 'd') as { value: { text: string } }).value.text).toBe(DECK)
    expect((history(dir, 'd') as { value: unknown[] }).value.length).toBe(2)
  })
})

describe('the live doors', () => {
  test('present: a listener gets the current state at once, then every move', async () => {
    const dir = project('present')
    const a: unknown[] = []
    const b: unknown[] = []
    const one = stream('GET', '/api/present', q({ project: dir, slug: 'talk' }), (e) => a.push(e))
    /* Attached once the host has said the folder is a project. */
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(one && 'close' in one).toBe(true)
    expect(a).toMatchObject([{ slug: 'talk', index: 0, blank: false, at: 0 }])

    expect((await answer('POST', '/api/present', none, { project: dir, slug: 'talk', index: 3 }, TICKET))?.status).toBe(200)
    const two = stream('GET', '/api/present', q({ project: dir, slug: 'talk' }), (e) => b.push(e))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(b).toMatchObject([{ index: 3, blank: false }])

    await answer('POST', '/api/present', none, { project: dir, slug: 'talk', index: 4, blank: true }, TICKET)
    expect(a.length).toBe(3)
    expect(b).toMatchObject([{ index: 3 }, { index: 4, blank: true }])
    if (one && 'close' in one) one.close()
    if (two && 'close' in two) two.close()

    expect((await answer('POST', '/api/present', none, { project: dir, slug: 'talk', index: -1 }, TICKET))?.status).toBe(400)
    const refused = stream('GET', '/api/present', q({ project: dir, slug: '../x' }), () => {})
    expect(refused && 'reply' in refused && refused.reply.status).toBe(400)
  })

  test('a GET that is not a stream door is left to (await answer())', async () => {
    expect(stream('GET', '/api/decks', none, () => {})).toBeNull()
    expect(stream('POST', '/api/present', none, () => {})).toBeNull()
  })
})

describe('citations', () => {
  const CHAPTER = 'Intro.\n\nThe mean rating was highest after the\nvanilla-JavaScript module (3.51). It fell — after React.\nThe end. The end.\n'

  async function cited(name: string): Promise<string> {
    const dir = project(name)
    mkdirSync(join(dir, 'ch'), { recursive: true })
    writeFileSync(join(dir, 'ch/4.tex'), CHAPTER)
    await tool('create_deck', { project: dir, title: 'D' })
    await tool('write_deck', { project: dir, deck: 'd', markdown: '# One\n- Mean 3.51 after vanilla\n', summary: 'draft' })
    return dir
  }

  test('cite_slide writes the marker and the source, and read_deck shows the lines it holds on', async () => {
    const dir = (await cited('cite'))
    const done = (await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'highest after the vanilla-JavaScript module', at: '3.51', agent: 'claude' }))
    expect(done).toEqual({ error: false, text: 'Slide 0 of "d" now cites ch/4.tex lines 3–4 as [^1], after "3.51".' })
    const text = (readDeck(dir, 'd') as { value: { text: string } }).value.text
    expect(text).toContain('- Mean 3.51[^1] after vanilla\nSources:\n[^1]: ch/4.tex | "highest after the vanilla-JavaScript module"')
    expect((history(dir, 'd') as { value: { summary: string }[] }).value[0]!.summary).toBe('cited ch/4.tex lines 3–4 on slide 0')
    const read = (await tool('read_deck', { project: dir, deck: 'd' })).text
    expect(read).toContain('1 citation, all holding.')
    expect(read).toContain('[^1] ch/4.tex lines 3–4: "highest after the vanilla-JavaScript module"')
  })

  test('a quote the file does not hold, or holds twice, is refused; one it no longer holds reads as adrift', async () => {
    const dir = (await cited('cite-refused'))
    expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'It rose' }))).toMatchObject({ error: true, text: expect.stringContaining('not in ch/4.tex') })
    expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'The end.' }))).toMatchObject({ error: true, text: expect.stringContaining('occur 2 times') })
    expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: '../x.tex', quote: 'a' }))).toMatchObject({ error: true, text: expect.stringContaining('not a file inside') })
    expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'It fell' })).error).toBe(false)
    writeFileSync(join(dir, 'ch/4.tex'), CHAPTER.replace('It fell', 'It dipped'))
    const read = (await tool('read_deck', { project: dir, deck: 'd' })).text
    expect(read).toContain('1 citation, 1 not holding (see below).')
    expect(read).toContain('[^1] ch/4.tex — ADRIFT, these words are no longer in the file: "It fell"')
  })

  test('the page reads every slide\'s citations, and the exact words of a selection', async () => {
    const dir = (await cited('cite-page'))
    await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: 'ch/4.tex', quote: 'It fell', at: '3.51' })
    const reply = (await answer('GET', '/api/citations', q({ project: dir, slug: 'd' }), null, TICKET))
    const slides = (reply?.body as { slides: { label: string; status: string; at: { from: number; line: number } }[][] }).slides
    expect(slides[0]![0]).toMatchObject({ label: '1', status: 'holds', at: { line: 4 } })
    const from = slides[0]![0]!.at.from
    const source = (await answer('GET', '/api/source', q({ project: dir, path: 'ch/4.tex', from: String(from), to: String(from + 7) }), null, TICKET))
    expect(source?.body).toEqual({ ok: true, text: 'It fell' })
    const outside = (await answer('GET', '/api/source', q({ project: dir, path: '../../etc/hosts', from: '0', to: '5' }), null, TICKET))
    expect(outside?.status).toBe(404)
  })

  test('a passage is read from a project with decks, and never from a dot-file in it', async () => {
    const dir = (await cited('cite-own'))
    writeFileSync(join(dir, '.env'), 'TOKEN=1\n')
    const bare = project('cite-bare')
    writeFileSync(join(bare, 'notes.txt'), 'some words\n')
    const read = async (query: Record<string, string>) => (await answer('GET', '/api/source', q({ from: '0', to: '5', ...query }), null, TICKET))
    expect((await read({ project: dir, path: 'ch/4.tex' }))?.status).toBe(200)
    expect((await read({ project: dir, path: '.env' }))?.status).toBe(404)
    expect((await read({ project: bare, path: 'notes.txt' }))?.status).toBe(404)
    expect((await read({ project: '/', path: 'etc/hosts' }))?.status).not.toBe(200)
    /* An agent's citation is confined the same way. */
    expect((await tool('cite_slide', { project: dir, deck: 'd', index: 0, path: '.env', quote: 'TOKEN=1' }))).toMatchObject({ error: true, text: expect.stringContaining('not a readable file') })
  })
})

describe('the picture door', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

  function made(name: string): string {
    const dir = project(name)
    createDeck(dir, 'Talk')
    mkdirSync(join(dir, 'figures'))
    writeFileSync(join(dir, 'figures', 'one.png'), PNG)
    writeFileSync(join(dir, 'figures', 'drawn.svg'), SVG)
    writeFileSync(join(dir, '.env'), 'TOKEN=1')
    return dir
  }
  const ask = async (query: Record<string, string>, header: string | null = null) => (await answer('GET', '/api/asset', q(query), null, header))

  test('it answers only the page that holds this process’s ticket, in the address or the header', async () => {
    const dir = made('asset-ticket')
    const picture = { project: dir, path: 'figures/one.png' }
    for (const reply of [(await ask(picture)), (await ask({ ...picture, ticket: 'not-the-ticket' })), (await ask(picture, 'not-the-ticket'))]) {
      expect(reply?.status).toBe(403)
      expect(reply?.raw).toBeUndefined()
      expect((reply?.body as { refused?: string }).refused).toBe('ticket')
    }
    expect((await ask({ ...picture, ticket: TICKET }))?.status).toBe(200)
    expect((await ask(picture, TICKET))?.status).toBe(200)
    expect((await answer('POST', '/api/asset', none, { ...picture }, TICKET))?.status).toBe(405)
  })

  test('a picture is sent as its own type, inert when opened on its own, and kept for a minute', async () => {
    const dir = made('asset-headers')
    const png = (await ask({ project: dir, path: 'figures/one.png', ticket: TICKET }))
    expect(png?.raw).toEqual({ bytes: PNG, type: 'image/png' })
    expect(png?.body).toBeNull()
    const svg = (await ask({ project: dir, path: 'figures/drawn.svg', ticket: TICKET }))
    expect(svg?.raw?.type).toBe('image/svg+xml')
    for (const reply of [png, svg]) {
      expect(reply?.headers).toEqual({
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
        'content-disposition': 'attachment',
      })
      expect(reply?.headers).toBe(PICTURE_HEADERS)
    }
  })

  test('everything it will not serve is the same 404, with nothing of the file in it', async () => {
    const dir = made('asset-refusals')
    const elsewhere = project('asset-no-decks')
    writeFileSync(join(elsewhere, 'one.png'), PNG)
    const refusals: Record<string, string>[] = [
      { project: dir, path: '.env' },
      { project: dir, path: '../asset-no-decks/one.png' },
      { project: dir, path: join(dir, 'figures', 'one.png') },
      { project: dir, path: 'figures/missing.png' },
      { project: dir },
      { path: 'figures/one.png' },
      /* A directory that is nobody's deck project is not read through this door. */
      { project: elsewhere, path: 'one.png' },
      { project: '/', path: 'etc/hosts' },
    ]
    for (const query of refusals) {
      const reply = (await ask({ ...query, ticket: TICKET }))
      expect([query, reply?.status, reply?.raw, reply?.headers]).toEqual([query, 404, undefined, undefined])
      expect(reply?.body).toEqual({ ok: false, error: 'There is no such picture in this project.' })
    }
  })
})
