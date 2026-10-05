import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { Screen } from '../src/app.tsx'
import type { PassageLike } from '../src/follow.ts'
import { PresenterView } from '../src/presenter.tsx'
import { PrintView } from '../src/print.tsx'
import { FALLBACK_NOTE } from '../src/stage.tsx'
import { decks as realDecks } from '../src/wire/decks.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { DECK, FakeEditor, editor, fakeDecks, host, pause, preview } from './fakes.tsx'

afterEach(cleanup)

const LINKED = `---
title: Defence
---

# Bridging the gap

---

<!-- section: chapters/2.tex | The problem -->
## The problem

Notes:
Say why it matters.

---

<!-- section: chapters/3.tex | Results -->
## Results
`

const CHAPTER_2 = '/work/thesis/chapters/2.tex'
/** A passage as the paper publishes one while scrolling: a section, no range. */
const reading = (title: string, path = CHAPTER_2): PassageLike => {
  const passage = { path, page: null, from: null, to: null, quoted: '', section: { title, from: null, to: null } }
  return passage
}

/** The screen with a host that records `passage.set`, and a way to say a new passage. */
function drawFollowing(text = LINKED, over: Partial<Host> = {}) {
  const fake = fakeDecks({}, { text })
  const asked: { method: string; params: unknown }[] = []
  const request: Host['request'] = async (method, params) => {
    asked.push({ method, params })
    return null
  }
  const at = (passage: PassageLike | null) => (
    <Screen
      host={host({ request, passage, ...over })}
      decks={fake.decks}
      editor={FakeEditor}
      saveDelay={20}
      publishDelay={5}
    />
  )
  const view = render(at(over.passage ?? null))
  return {
    fake,
    asked,
    published: () => asked.filter((one) => one.method === 'passage.set').map((one) => one.params),
    read: (passage: PassageLike | null) => view.rerender(at(passage)),
  }
}

const heading = () => preview().getByRole('heading').textContent
const position = () => preview().getByTestId('position').textContent
const following = () => screen.getByTestId('following')

describe('following the paper', () => {
  test('a new section moves the slides to the first slide linked to it, without publishing back', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    run.read(reading('The problem'))
    await waitFor(() => expect(heading()).toBe('The problem'))
    await pause(20)
    expect(run.published()).toEqual([])
  })

  test('no slides for the section: stays, and the indicator says so', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    run.read(reading('Appendix'))
    await waitFor(() => expect(following().textContent).toBe('No slides for Appendix'))
    expect(position()).toBe('1 / 3')
  })

  test('the same passage sent again does not pull the slides back', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    run.read(reading('The problem'))
    await waitFor(() => expect(heading()).toBe('The problem'))
    fireEvent.click(screen.getByRole('button', { name: 'slide 1' }))
    run.read(reading('The problem'))
    await pause(10)
    expect(position()).toBe('1 / 3')
  })

  test('moving to a linked slide turns the paper to its section', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    fireEvent.click(screen.getByRole('button', { name: 'slide 3' }))
    await waitFor(() => expect(run.published()).toHaveLength(1))
    expect(run.published()[0]).toEqual({
      passage: {
        path: '/work/thesis/chapters/3.tex',
        page: null,
        from: null,
        to: null,
        quoted: '',
        section: { title: 'Results', from: null, to: null },
      },
    })
    /* The paper says it back: that is not a reason to move. */
    run.read(reading('Results', '/work/thesis/chapters/3.tex'))
    await pause(10)
    expect(heading()).toBe('Results')
  })

  test('turned off, neither direction happens', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    fireEvent.click(following())
    expect(following().getAttribute('aria-pressed')).toBe('false')
    run.read(reading('The problem'))
    fireEvent.click(screen.getByRole('button', { name: 'slide 3' }))
    await pause(20)
    expect(run.published()).toEqual([])
    expect(heading()).toBe('Results')

    /* Back on: it catches up with where the paper is. */
    fireEvent.click(following())
    await waitFor(() => expect(heading()).toBe('The problem'))
  })
})

describe('linking a slide', () => {
  test('links the slide on screen to the section being read, in the text, and saves it', async () => {
    const run = drawFollowing(DECK)
    await waitFor(() => expect(editor().value).toBe(DECK))
    const link = () => screen.getByRole('button', { name: /Link to the section you're reading/ }) as HTMLButtonElement
    expect(link().disabled).toBe(true)

    run.read(reading('Bridging the gap', '/work/thesis/chapters/2_bridge.tex'))
    await waitFor(() => expect(link().disabled).toBe(false))
    fireEvent.click(link())
    expect(editor().value).toContain('<!-- layout: title; section: chapters/2_bridge.tex | Bridging the gap -->\n# Bridging the gap')
    await waitFor(() => expect(run.fake.of('save')).toHaveLength(1))
    expect(preview().getByTestId('section-chip').textContent).toContain('Bridging the gap')
    expect(link().disabled).toBe(true)

    fireEvent.click(preview().getByRole('button', { name: 'unlink from Bridging the gap' }))
    expect(editor().value).not.toContain('section:')
    expect(preview().queryByTestId('section-chip')).toBeNull()
  })

  test('a paper file outside the project cannot be linked', async () => {
    const run = drawFollowing(DECK)
    await waitFor(() => expect(editor().value).toBe(DECK))
    run.read(reading('Elsewhere', '/somewhere/else.tex'))
    await pause(5)
    const link = screen.getByRole('button', { name: /Link to the section/ }) as HTMLButtonElement
    expect(link.disabled).toBe(true)
    expect(link.title).toMatch(/not inside this project/)
  })
})

describe('presenting', () => {
  const stage = () => screen.getByTestId('stage')
  const key = (name: string) => fireEvent.keyDown(window, { key: name })

  test('without the Fullscreen API it fills the window and says so; keys move and post the talk', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(stage().getAttribute('data-presenting')).toBe('window')
    expect(within(stage()).getByRole('status').textContent).toBe(FALLBACK_NOTE)
    await waitFor(() => expect(run.fake.of('present').map((call) => call.args.slice(2))).toEqual([[0, false]]))

    key('ArrowRight')
    key(' ')
    await waitFor(() => expect(position()).toBe('3 / 3'))
    key('PageDown')
    key('b')
    await waitFor(() =>
      expect(run.fake.of('present').map((call) => call.args.slice(2))).toEqual([
        [0, false],
        [1, false],
        [2, false],
        [2, true],
      ]),
    )
    expect(within(stage()).queryByTestId('slide-view')).toBeNull()
    key('Home')
    await waitFor(() => expect(position()).toBe('1 / 3'))

    key('Escape')
    expect(stage().getAttribute('data-presenting')).toBeNull()
  })

  test('following is paused while presenting, publishing is not', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    run.read(reading('The problem'))
    await pause(10)
    expect(position()).toBe('1 / 3')
    key('End')
    await waitFor(() => expect(run.published()).toHaveLength(1))
  })

  test('full screen is asked of the stage, and leaving it ends the talk', async () => {
    const proto = HTMLElement.prototype as unknown as { requestFullscreen?: () => Promise<void> }
    let asked: Element | null = null
    proto.requestFullscreen = function (this: Element) {
      asked = this
      return Promise.resolve()
    }
    try {
      const run = drawFollowing()
      await waitFor(() => expect(editor().value).toBe(LINKED))
      fireEvent.click(screen.getByRole('button', { name: 'Present' }))
      expect(asked === stage()).toBe(true)
      expect(stage().getAttribute('data-presenting')).toBe('fullscreen')
      expect(within(stage()).queryByRole('status')).toBeNull()
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      expect(stage().getAttribute('data-presenting')).toBeNull()
      expect(run.fake.of('followTalk')).toHaveLength(1)
    } finally {
      delete proto.requestFullscreen
    }
  })

  test('a move from the presenter view moves the stage; its own echo does not', async () => {
    const run = drawFollowing()
    await waitFor(() => expect(editor().value).toBe(LINKED))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    /* What the server held from an earlier talk is not where this one is. */
    await run.fake.talk({ index: 2, blank: false, at: 1 })
    expect(position()).toBe('1 / 3')
    await run.fake.talk({ index: 0, blank: false, at: Date.now() + 1 })
    await run.fake.talk({ index: 1, blank: false, at: Date.now() + 2 })
    await waitFor(() => expect(position()).toBe('2 / 3'))
    await pause(5)
    expect(run.fake.of('present').map((call) => call.args[2])).toEqual([0])
  })
})

describe('the talk on the wire', () => {
  test('a move is a ticketed POST to /api/present', async () => {
    const was = globalThis.fetch
    const sent: { url: string; init: RequestInit | undefined }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, state: {} }), { status: 200 })
    }) as typeof fetch
    try {
      await realDecks.present('/work/thesis', 'defence', 3, true)
    } finally {
      globalThis.fetch = was
    }
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('./api/present')
    expect(sent[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({ project: '/work/thesis', slug: 'defence', index: 3, blank: true })
    expect(Object.keys(sent[0]?.init?.headers ?? {})).toContain('x-module-ticket')
  })

  test('a refused move rejects with the server’s sentence', async () => {
    const was = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'no such deck' }), { status: 400 })) as unknown as typeof fetch
    try {
      await expect(realDecks.present('/w', 'd', 0, false)).rejects.toThrow('no such deck')
    } finally {
      globalThis.fetch = was
    }
  })
})

describe('windows of their own', () => {
  test('a blocked presenter window shows its address to open by hand', async () => {
    const was = window.open
    const opened: string[] = []
    window.open = ((url: string) => {
      opened.push(url)
      return null
    }) as typeof window.open
    /* Where the page is served, so the addresses have a base to sit next to. */
    ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://127.0.0.1:7990/app')
    try {
      drawFollowing()
      await waitFor(() => expect(editor().value).toBe(LINKED))
      fireEvent.click(screen.getByRole('button', { name: 'Presenter view' }))
      expect(opened[0]).toBe('http://127.0.0.1:7990/app?presenter=defence&project=%2Fwork%2Fthesis&theme=dark')
      expect(screen.getByText(/Open it in your browser/)).toBeDefined()
      expect((screen.getByLabelText('The presenter view address') as HTMLInputElement).value).toBe(opened[0] ?? '')

      fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
      expect(opened[1]).toBe('http://127.0.0.1:7990/print?deck=defence&project=%2Fwork%2Fthesis&theme=dark')
      expect((screen.getByLabelText('The print view address') as HTMLInputElement).value).toBe(opened[1] ?? '')
    } finally {
      window.open = was
    }
  })

  test('the presenter view shows the slide, the next one and the notes, and drives the talk', async () => {
    const fake = fakeDecks({}, { text: LINKED })
    render(<PresenterView project="/work/thesis" slug="defence" decks={fake.decks} />)
    await screen.findByRole('region', { name: 'notes' })
    await fake.talk({ index: 1, blank: false, at: 5 })
    const region = (name: string) => within(screen.getByRole('region', { name }))
    await waitFor(() => expect(region('current slide').getByRole('heading').textContent).toBe('The problem'))
    expect(region('next slide').getByRole('heading').textContent).toBe('Results')
    expect(region('notes').getByText('Say why it matters.')).toBeDefined()
    expect(screen.getByTestId('presenter-position').textContent).toBe('slide 2 / 3')
    expect(screen.getByTestId('timer').textContent).toBe('0:00')
    expect(fake.of('present')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(fake.of('present').map((call) => call.args.slice(2))).toEqual([[2, false]]))
    expect(region('next slide').getByText('The end of the deck.')).toBeDefined()
    expect(region('notes').getByText('No notes for this slide.')).toBeDefined()
  })

  test('the print view draws every slide, one per page, and prints once settled', async () => {
    const fake = fakeDecks({}, { text: LINKED })
    let printed = 0
    render(
      <PrintView project="/work/thesis" slug="defence" decks={fake.decks} print={() => printed++} ready={() => Promise.resolve()} />,
    )
    await waitFor(() => expect(printed).toBe(1))
    const pages = screen.getAllByTestId('print-slide')
    expect(pages).toHaveLength(3)
    expect(pages[0]?.style.width).toBe('1280px')
    expect(pages.map((page) => page.querySelector('h1, h2')?.textContent)).toEqual(['Bridging the gap', 'The problem', 'Results'])
    expect(document.querySelector('style')?.textContent).toContain('@page { size: 1280px 720px; margin: 0; }')
  })
})
