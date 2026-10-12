import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PointerState } from '../deck/api.ts'
import { TICKET, answer as door, stream } from '../doors.ts'
import { POINTER } from '../live.ts'
import { Screen } from '../src/app.tsx'
import { deckPath, slidePointed, type PassageLike } from '../src/follow.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { history, readDeck } from '../store.ts'
import { FakeEditor, editor, fakeDecks, host, pause, preview } from './fakes.tsx'
import { answer } from './now.ts'

/**
 * A deck turned from outside its page: an agent's `show_slide` on the door,
 * and another module's passage naming the deck's file. Both are pointers — the
 * page goes there once, nothing is written, and the paper is not turned.
 */

afterEach(cleanup)

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-show-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

const none = new URLSearchParams()
const q = (query: Record<string, string>) => new URLSearchParams(query)

function tool(name: string, args: Record<string, unknown>): { text: string; error: boolean } {
  const reply = answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null)
  const result = (reply?.body as { result?: { content?: { text: string }[]; isError?: boolean } }).result
  return { text: result?.content?.[0]?.text ?? '', error: result?.isError === true }
}

interface Said {
  deck: string
  index: number
  slide: string
  slides: number
  outcome: string
  pages: number
  open: number
  outside: number
  hidden: number
  stale: number
  presenting: number
  silent: number
  why: string
}

/** show_slide, which waits for the pages it pointed: the words, and the same thing for a program. */
async function show(args: Record<string, unknown>): Promise<{ text: string; error: boolean; said: Said | undefined }> {
  const reply = await door('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'show_slide', arguments: args } }, null)
  const result = (reply?.body as { result?: { content?: { text: string }[]; isError?: boolean; structuredContent?: Said } }).result
  return { text: result?.content?.[0]?.text ?? '', error: result?.isError === true, said: result?.structuredContent }
}

/**
 * A page open on a deck, as the door sees one: it listens on the pointer door,
 * and says what it did with each pointing — unless `does` is null, which is a
 * page that says nothing.
 */
function page(dir: string, does: { did: string; hidden?: boolean } | null = { did: 'shown' }, presenting = false) {
  const seen: PointerState[] = []
  const heard: unknown[] = []
  const opened = stream('GET', '/api/pointer', q(presenting ? { project: dir, slug: 'd', presenting: '1' } : { project: dir, slug: 'd' }), (event) => {
    const state = event as PointerState
    seen.push(state)
    if (state.at === 0 || !does) return
    /* As a page does: after the door has finished telling it, on a request of its own. */
    queueMicrotask(() => heard.push(answer('POST', '/api/pointer', none, { project: dir, slug: 'd', at: state.at, ...does }, TICKET)?.body))
  })
  return { seen, heard, close: () => opened && 'close' in opened && opened.close() }
}

const DECK = `---
title: Defence
---

# Bridging the gap

---

<!-- section: chapters/2.tex | The problem -->
## The problem

---

<!-- section: chapters/3.tex | Results -->
## Results
`

function drafted(name: string): string {
  const dir = project(name)
  tool('create_deck', { project: dir, title: 'D' })
  tool('write_deck', { project: dir, deck: 'd', markdown: DECK, summary: 'draft' })
  return dir
}

const textOf = (dir: string) => (readDeck(dir, 'd') as { value: { text: string } }).value.text
const entries = (dir: string) => (history(dir, 'd') as { value: unknown[] }).value.length

const WAIT = POINTER.waitMs
beforeEach(() => {
  /* A page here answers within a microtask; a page that never does is waited for this long. */
  POINTER.waitMs = 40
})
afterAll(() => {
  POINTER.waitMs = WAIT
})

describe('show_slide on the MCP door', () => {
  test('a page open on the deck is told, and the answer is what that page said: the slide is on its screen', async () => {
    const dir = drafted('watched')
    const one = page(dir)
    expect(one.seen).toEqual([{ slug: 'd', index: 0, at: 0 }])

    const shown = await show({ project: dir, deck: 'd', index: 2 })
    expect(shown.error).toBe(false)
    expect(shown.text).toBe(
      'Slide 2 of "d" (Results; 3 in the deck) is on screen in one open Slides page on this deck. '
      + 'Nothing was written; the person can turn away, and the next show_slide is followed again.',
    )
    expect(shown.said).toEqual({ deck: 'd', index: 2, slide: 'Results', slides: 3, outcome: 'shown', pages: 1, open: 1, outside: 0, hidden: 0, stale: 0, presenting: 0, silent: 0, why: '' })
    expect(one.seen[1]).toMatchObject({ slug: 'd', index: 2 })
    expect(one.heard).toEqual([{ ok: true, heard: true }])

    /* The same slide again is a new pointing: the person may have turned away in between. */
    await show({ project: dir, deck: 'd', index: '2' })
    expect(one.seen).toHaveLength(3)
    expect(one.seen[2]!.at).toBeGreaterThan(one.seen[1]!.at)
    one.close()
  })

  test('with no page open it says nobody saw, without waiting, and a page that opens later is not turned', async () => {
    const dir = drafted('unwatched')
    POINTER.waitMs = 60_000
    const shown = await show({ project: dir, deck: 'd', index: 1 })
    expect(shown.error).toBe(false)
    expect(shown.text).toMatch(/^No Slides page is open on "d", so nobody was shown slide 1 of "d" \(The problem; 3 in the deck\)\. Nothing was turned and nothing was written\./)
    expect(shown.said).toMatchObject({ outcome: 'unseen', pages: 0, open: 0, why: 'No Slides page is open on "d".' })

    const late = page(dir)
    expect(late.seen).toEqual([{ slug: 'd', index: 0, at: 0 }])
    late.close()
  })

  test('a slide outside the parts picked on a page is on its screen as the slide in hand, and the answer says so', async () => {
    const dir = drafted('outside')
    const one = page(dir, { did: 'outside' })
    const shown = await show({ project: dir, deck: 'd', index: 0 })
    expect(shown.text).toBe(
      'Slide 0 of "d" (Bridging the gap; 3 in the deck) is on screen in one open Slides page on this deck. '
      + 'It is outside the parts picked on that page, so it is drawn there as the slide in hand, until the person turns to another slide. '
      + 'Nothing was written; the person can turn away, and the next show_slide is followed again.',
    )
    expect(shown.said).toMatchObject({ outcome: 'shown', pages: 1, open: 1, outside: 1 })

    const two = page(dir)
    const both = await show({ project: dir, deck: 'd', index: 0 })
    expect(both.text).toContain('is on screen in 2 open Slides pages on this deck. On 1 of them it is outside the picked parts, and is drawn there as the slide in hand')
    expect(both.said).toMatchObject({ outcome: 'shown', pages: 2, open: 2, outside: 1 })
    one.close()
    two.close()
  })

  test('a page that turned in a hidden window is not somebody seeing it', async () => {
    const dir = drafted('hidden')
    const one = page(dir, { did: 'shown', hidden: true })
    const shown = await show({ project: dir, deck: 'd', index: 2 })
    expect(shown.error).toBe(false)
    expect(shown.text).toBe(
      'Nobody is known to be looking at slide 2 of "d" (Results; 3 in the deck): one open Slides page on this deck, and none is showing it where it can be seen. '
      + 'One page turned to it in a window that is hidden, where nobody is looking. Nothing was written.',
    )
    expect(shown.said).toMatchObject({ outcome: 'unseen', pages: 0, open: 1, hidden: 1, why: 'One page turned to it in a window that is hidden, where nobody is looking.' })
    one.close()
  })

  test('a page that does not say what it did is waited for, and then is not counted as showing', async () => {
    const dir = drafted('silent')
    const one = page(dir, null)
    const began = Date.now()
    const shown = await show({ project: dir, deck: 'd', index: 2 })
    expect(Date.now() - began).toBeGreaterThanOrEqual(35)
    expect(one.seen[1]).toMatchObject({ index: 2 })
    expect(shown.text).toContain('Nobody is known to be looking at slide 2 of "d"')
    expect(shown.text).toContain('One page was sent the pointer and did not say within 40 ms what it did, so whether it turned is not known.')
    expect(shown.said).toMatchObject({ outcome: 'unseen', pages: 0, open: 1, silent: 1 })

    /* Beside one that does say, the slide is shown — on one page, and the other is still said to be unknown. */
    const two = page(dir)
    const both = await show({ project: dir, deck: 'd', index: 1 })
    expect(both.said).toMatchObject({ outcome: 'shown', pages: 1, open: 2, silent: 1 })
    expect(both.text).toMatch(/^Slide 1 of "d" \(The problem; 3 in the deck\) is on screen in one open Slides page on this deck\. One page was sent the pointer and did not say/)
    one.close()
    two.close()
  })

  test('a page holding unsaved text without that slide does not turn, and the deck is said to have declined', async () => {
    const dir = drafted('stale')
    const one = page(dir, { did: 'stale' })
    const shown = await show({ project: dir, deck: 'd', index: 2 })
    expect(shown.text).toContain('One page was not turned: it holds text that is not saved and has no slide 2 in it.')
    expect(shown.said).toMatchObject({ outcome: 'declined', pages: 0, open: 1, stale: 1 })
    one.close()
  })

  test('a page that is presenting is counted and not told, and the answer says the deck was not turned', async () => {
    const dir = drafted('presented')
    const stage = page(dir, { did: 'shown' }, true)
    const alone = await show({ project: dir, deck: 'd', index: 2 })
    expect(alone.error).toBe(false)
    expect(alone.text).toBe(
      'Nobody is known to be looking at slide 2 of "d" (Results; 3 in the deck): one open Slides page on this deck, and none is showing it where it can be seen. '
      + 'One page is presenting and was not turned: a talk is not turned from outside. Nothing was written. Call show_slide again once the talk is over.',
    )
    expect(alone.said).toMatchObject({ outcome: 'declined', pages: 0, open: 1, presenting: 1 })

    const one = page(dir)
    const both = await show({ project: dir, deck: 'd', index: 1 })
    expect(both.text).toMatch(/^Slide 1 of "d" \(The problem; 3 in the deck\) is on screen in one open Slides page on this deck\. One page is presenting and was not turned: a talk is not turned from outside\./)
    expect(both.said).toMatchObject({ outcome: 'shown', pages: 1, open: 2, presenting: 1 })
    expect(one.seen[1]).toMatchObject({ slug: 'd', index: 1 })
    expect(stage.seen).toEqual([{ slug: 'd', index: 0, at: 0 }])

    /* A page that began its talk as the pointer was on its way says so itself. */
    const racing = page(dir, { did: 'presenting' })
    one.close()
    expect((await show({ project: dir, deck: 'd', index: 1 })).said).toMatchObject({ outcome: 'declined', open: 2, presenting: 2 })
    stage.close()
    racing.close()
  })

  test('what a page says is taken only for the pointing being waited on, only in the words there are, and only from the page', async () => {
    const dir = drafted('heard')
    const one = page(dir, null)
    const waiting = show({ project: dir, deck: 'd', index: 2 })
    const at = one.seen[1]!.at
    const say = (body: Record<string, unknown>, ticket: string | null = TICKET) => answer('POST', '/api/pointer', none, { project: dir, slug: 'd', ...body }, ticket)
    expect(say({ at, did: 'shown' }, null)?.status).toBe(403)
    expect(say({ at, did: 'looked at' })?.status).toBe(400)
    expect(say({ did: 'shown' })?.status).toBe(400)
    expect(say({ at: at - 1, did: 'shown' })?.body).toEqual({ ok: true, heard: false })
    expect(say({ at, did: 'shown' })?.body).toEqual({ ok: true, heard: true })
    expect((await waiting).said).toMatchObject({ outcome: 'shown', pages: 1 })
    /* Said again once it has been answered: nobody is waiting. */
    expect(say({ at, did: 'shown' })?.body).toEqual({ ok: true, heard: false })
    one.close()
  })

  test('a second pointing ends the wait for the first, which answers with what it had heard', async () => {
    const dir = drafted('twice')
    POINTER.waitMs = 60_000
    const one = page(dir, null)
    const first = show({ project: dir, deck: 'd', index: 1 })
    await Promise.resolve()
    const second = show({ project: dir, deck: 'd', index: 2 })
    expect((await first).said).toMatchObject({ outcome: 'unseen', silent: 1, index: 1 })
    answer('POST', '/api/pointer', none, { project: dir, slug: 'd', at: one.seen[2]!.at, did: 'shown' }, TICKET)
    expect((await second).said).toMatchObject({ outcome: 'shown', pages: 1, index: 2 })
    one.close()
  })

  test('showing writes nothing: the deck and its history are as they were', async () => {
    const dir = drafted('pointer-only')
    const one = page(dir)
    await show({ project: dir, deck: 'd', index: 2 })
    one.close()
    await show({ project: dir, deck: 'd', index: 0 })
    expect(textOf(dir)).toBe(DECK)
    expect(entries(dir)).toBe(2)
  })

  test('a slide that is not there is refused with the deck’s own slides, and nobody is told', async () => {
    const dir = drafted('refused')
    const one = page(dir)
    for (const index of [3, -1, 1.5, 'six', undefined]) {
      const refused = await show({ project: dir, deck: 'd', index })
      expect(refused.error).toBe(true)
      expect(refused.said).toBeUndefined()
      expect(refused.text).toContain('is not a slide of "d": it has 3 slides, numbered 0 to 2, as read_deck numbers them:')
      expect(refused.text).toContain('0. Bridging the gap\n1. The problem\n2. Results\nNothing was shown.')
    }
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ project: dir, deck: 'nope', index: 0 }, /no deck "nope".*list_decks/],
      [{ project: dir, deck: '../x', index: 0 }, /not a deck name/],
      [{ deck: 'd', index: 0 }, /needs project/],
    ]
    for (const [args, why] of cases) {
      const refused = await show(args)
      expect(refused.error).toBe(true)
      expect(refused.text).toMatch(why)
    }
    expect(one.seen).toHaveLength(1)
    one.close()
  })

  test('it is listed as a tool that writes nothing, with the shape of its answer', () => {
    const reply = answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)
    const listed = (reply?.body as { result: { tools: { name: string; annotations?: unknown; inputSchema: { required: string[] }; outputSchema?: { required: string[]; properties: { outcome: { enum: string[] } } } }[] } }).result.tools
    const one = listed.find((each) => each.name === 'show_slide')!
    expect(one.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false })
    expect(one.inputSchema.required).toEqual(['project', 'deck', 'index'])
    expect(one.outputSchema?.properties.outcome.enum).toEqual(['shown', 'unseen', 'declined'])
    expect(one.outputSchema?.required).toEqual(['deck', 'index', 'slide', 'slides', 'outcome', 'pages', 'open', 'outside', 'hidden', 'stale', 'presenting', 'silent', 'why'])
    /* No tool that writes a deck claims to only read. */
    for (const each of listed) if (each.name !== 'show_slide') expect((each.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint).not.toBe(true)
  })

  test('the pointer door refuses a deck name that is not one', () => {
    const refused = stream('GET', '/api/pointer', q({ project: project('door'), slug: '../x' }), () => {})
    expect(refused && 'reply' in refused && refused.reply.status).toBe(400)
    expect(answer('POST', '/api/pointer', none, { project: project('door'), slug: '../x', at: 1, did: 'shown' }, TICKET)?.status).toBe(400)
  })
})

const PROJECT = '/work/thesis'
const FILE = `${PROJECT}/.kehikot/slides/defence.md`
const pointing = (over: Partial<PassageLike>): PassageLike => ({ path: FILE, page: null, from: null, to: null, section: null, ...over })
const bytes = (text: string, before: string) => new TextEncoder().encode(text.slice(0, text.indexOf(before))).length

describe('a passage naming the deck’s file', () => {
  test('the file is the deck’s own, under the project', () => {
    expect(deckPath(PROJECT, 'defence')).toBe(FILE)
    expect(deckPath(`${PROJECT}/`, 'defence')).toBe(FILE)
  })

  test('a page is the slide’s number, counting from 1', () => {
    expect(slidePointed(pointing({ page: 1 }), PROJECT, 'defence', DECK)).toBe(0)
    expect(slidePointed(pointing({ page: 3 }), PROJECT, 'defence', DECK)).toBe(2)
    expect(slidePointed(pointing({ page: 4 }), PROJECT, 'defence', DECK)).toBeNull()
  })

  test('a range is bytes of the Markdown, and wins over the page', () => {
    const accented = DECK.replace('Bridging the gap', 'Bridging the gäp — née')
    const from = bytes(accented, '## Results')
    expect(from).toBeGreaterThan(accented.indexOf('## Results'))
    expect(slidePointed(pointing({ from, to: from + 5, page: 1 }), PROJECT, 'defence', accented)).toBe(2)
    expect(slidePointed(pointing({ from: bytes(DECK, '## The problem'), to: bytes(DECK, '## Results') }), PROJECT, 'defence', DECK)).toBe(1)
  })

  test('a place the deck does not have is refused, not taken as the nearest slide', () => {
    const size = new TextEncoder().encode(DECK).length
    const third = DECK.indexOf('---\n\n<!-- section: chapters/3.tex') + '---\n'.length
    const at = (from: number) => slidePointed(pointing({ from, to: from }), PROJECT, 'defence', DECK)
    expect(at(third - 1)).toBe(2)
    expect(at(third)).toBe(2)
    expect(at(0)).toBe(0)
    expect(at(size - 1)).toBe(2)
    expect(at(size)).toBe(2)
    expect(at(size + 1)).toBeNull()
    expect(at(-1)).toBeNull()
    expect(at(1.5)).toBeNull()

    const page = (number: number) => slidePointed(pointing({ page: number }), PROJECT, 'defence', DECK)
    expect(page(0)).toBeNull()
    expect(page(3)).toBe(2)
    expect(page(4)).toBeNull()
    expect(page(1.5)).toBeNull()
  })

  test('another file, another deck, or no slide named: nothing is pointed at', () => {
    expect(slidePointed(null, PROJECT, 'defence', DECK)).toBeNull()
    expect(slidePointed(pointing({}), PROJECT, 'defence', DECK)).toBeNull()
    expect(slidePointed(pointing({ page: 2 }), PROJECT, 'other', DECK)).toBeNull()
    expect(slidePointed(pointing({ page: 2, path: `${PROJECT}/chapters/2.tex` }), PROJECT, 'defence', DECK)).toBeNull()
  })
})

function draw(over: Partial<Host> = {}, decks: Parameters<typeof fakeDecks>[0] = {}) {
  const fake = fakeDecks(decks, { text: DECK })
  const asked: string[] = []
  const request: Host['request'] = async (method) => {
    asked.push(method)
    return null
  }
  const at = (passage: PassageLike | null) => (
    <Screen host={host({ request, passage, ...over })} decks={fake.decks} editor={FakeEditor} saveDelay={20} publishDelay={5} />
  )
  const view = render(at(over.passage ?? null))
  return { fake, turned: () => asked.filter((method) => method === 'passage.set'), read: (passage: PassageLike | null) => view.rerender(at(passage)) }
}

const heading = () => preview().getByRole('heading').textContent
/** What the page told the door it did with each pointing: when it was made, what was done, whether the window was hidden. */
const saidBack = (fake: ReturnType<typeof fakeDecks>) => fake.of('pointed').map((call) => call.args.slice(2))
const position = () => preview().getByTestId('position').textContent

describe('the page, pointed at a slide', () => {
  test('goes to it without turning the paper or saving, lets the person turn away, and follows the next pointing', async () => {
    const run = draw()
    await waitFor(() => expect(editor().value).toBe(DECK))
    run.fake.point(2, 100)
    await waitFor(() => expect(heading()).toBe('Results'))
    await pause(30)
    expect(run.turned()).toEqual([])
    expect(run.fake.of('save')).toEqual([])
    /* And it tells the door what it did, which is what show_slide answers with. */
    expect(saidBack(run.fake)).toEqual([[100, 'shown', false]])

    fireEvent.click(screen.getByRole('button', { name: 'slide 1' }))
    await waitFor(() => expect(position()).toBe('1 / 3'))
    /* The stream saying the same pointing again (a reconnect) is not a new one. */
    run.fake.point(2, 100)
    await pause(10)
    expect(position()).toBe('1 / 3')
    run.fake.point(2, 101)
    await waitFor(() => expect(heading()).toBe('Results'))
    /* Pointed at the slide it is already on, it says so too: the slide is on its screen. */
    run.fake.point(2, 102)
    await waitFor(() => expect(saidBack(run.fake)).toEqual([[100, 'shown', false], [101, 'shown', false], [102, 'shown', false]]))
  })

  test('a page too narrow for both panes turns to the one the slide is drawn in', async () => {
    const run = draw()
    await waitFor(() => expect(editor().value).toBe(DECK))
    const tab = (name: string) => screen.getByRole('tab', { name }).getAttribute('aria-selected')
    expect(tab('Edit')).toBe('true')
    run.fake.point(2, 100)
    await waitFor(() => expect(tab('Preview')).toBe('true'))
    expect(heading()).toBe('Results')
    /* The person takes the Markdown back, and the next pointing shows the slide again. */
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    expect(tab('Edit')).toBe('true')
    run.fake.point(1, 101)
    await waitFor(() => expect(tab('Preview')).toBe('true'))
  })

  test('what the door held when the page arrived is not gone to', async () => {
    draw({}, {
      followPointer(_project, slug, onPoint) {
        onPoint({ slug, index: 2, at: 50 })
        return () => {}
      },
    })
    await waitFor(() => expect(editor().value).toBe(DECK))
    await pause(10)
    expect(position()).toBe('1 / 3')
  })

  test('a slide the deck does not have is not gone to', async () => {
    const run = draw()
    await waitFor(() => expect(editor().value).toBe(DECK))
    run.fake.point(7, 100)
    await pause(10)
    expect(position()).toBe('1 / 3')
    expect(saidBack(run.fake)).toEqual([[100, 'stale', false]])
  })

  test('a talk is not turned: while presenting neither a pointing nor a passage moves the slide, and neither is kept for afterwards', async () => {
    const run = draw()
    const told = () => run.fake.of('followPointer').at(-1)!.args[2]
    await waitFor(() => expect(editor().value).toBe(DECK))
    expect(told()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    await waitFor(() => expect(told()).toBe(true))
    run.fake.point(2, 100)
    run.read(pointing({ page: 2 }))
    await pause(10)
    expect(position()).toBe('1 / 3')
    expect(saidBack(run.fake)).toEqual([[100, 'presenting', false]])

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(told()).toBe(false))
    await pause(10)
    expect(position()).toBe('1 / 3')
    run.fake.point(2, 101)
    await waitFor(() => expect(heading()).toBe('Results'))
  })

  test('another module’s passage on the deck’s file brings its slide up, once', async () => {
    const run = draw()
    await waitFor(() => expect(editor().value).toBe(DECK))
    run.read(pointing({ page: 2 }))
    await waitFor(() => expect(heading()).toBe('The problem'))
    await pause(30)
    expect(run.turned()).toEqual([])
    /* A passage is answered to nobody: no door is waiting to hear of it. */
    expect(saidBack(run.fake)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'slide 3' }))
    await waitFor(() => expect(heading()).toBe('Results'))
    run.read(pointing({ page: 2 }))
    await pause(10)
    expect(heading()).toBe('Results')
  })
})
