import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { parseSlide } from '../deck/format.ts'
import { PictureProject, assetUrl, isProjectPath } from '../src/slides/markdown.tsx'
import { SlideView, leadingHeading } from '../src/slides/slide-view.tsx'

afterEach(cleanup)

/* Where the page is served. With no address at all, happy-dom fails a picture named by a relative path at once. */
beforeAll(() => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://127.0.0.1:7990/app'))

const draw = (raw: string, props: { showSection?: boolean } = {}) =>
  render(<SlideView slide={parseSlide(raw)} {...props} />).container

describe('SlideView', () => {
  test('a title slide shows its heading and subtitle', () => {
    const view = draw('<!-- layout: title -->\n# Bridging the gap\nA thesis defence')
    expect(view.querySelector('[data-layout="title"]')).not.toBeNull()
    expect(view.querySelector('h1')?.textContent).toBe('Bridging the gap')
    expect(view.textContent).toContain('A thesis defence')
  })

  test('a bullets slide shows its heading and list', () => {
    const view = draw('## The problem\n- one\n- two')
    expect(view.querySelector('[data-layout="bullets"] h2')?.textContent).toBe('The problem')
    expect([...view.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two'])
  })

  test('a two-column slide splits on ||| under one heading', () => {
    const view = draw('<!-- layout: two-column -->\n## Before and after\nleft side\n|||\nright side')
    const grid = view.querySelector('.grid')
    expect(grid?.children.length).toBe(2)
    expect(grid?.children[0]?.textContent).toContain('left side')
    expect(grid?.children[0]?.textContent).not.toContain('right side')
    expect(grid?.children[1]?.textContent).toContain('right side')
    expect(view.querySelector('h2')?.textContent).toBe('Before and after')
  })

  test('an image slide fills with the picture and keeps the caption', () => {
    const view = draw('<!-- layout: image -->\n![a bridge](figures/bridge.png)\nThe bridge, 1890')
    const img = view.querySelector('.slide-picture img') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toBe(assetUrl('figures/bridge.png'))
    expect(img?.getAttribute('alt')).toBe('a bridge')
    expect(view.querySelector('.slide-caption')?.textContent).toContain('The bridge, 1890')
  })

  test('with a project named, a picture is fetched from this app’s own door for it; a URL is left as written', () => {
    const view = render(
      <PictureProject.Provider value="/work/thesis">
        <SlideView slide={parseSlide('![a bridge](figures/bridge.png)\n\n![far](https://example.org/far.png)')} />
      </PictureProject.Provider>,
    ).container
    expect([...view.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      './api/asset?project=%2Fwork%2Fthesis&path=figures%2Fbridge.png',
      'https://example.org/far.png',
    ])
  })

  test('the door’s address carries the page’s ticket, and no project leaves the path as written', () => {
    expect(assetUrl('figures/a b.png', '/work/thesis', 'T1')).toBe('./api/asset?project=%2Fwork%2Fthesis&path=figures%2Fa+b.png&ticket=T1')
    expect(assetUrl('figures/bridge.png', null, 'T1')).toBe('figures/bridge.png')
  })

  test('a picture that does not load is a box with its alt text, and is not asked for again', () => {
    const slide = parseSlide('<!-- layout: image -->\n## Bridge\n![a bridge](figures/gone.png)\nThe bridge, 1890')
    const first = render(<SlideView slide={slide} />)
    fireEvent.error(first.container.querySelector('img')!)
    expect(first.container.querySelector('img')).toBeNull()
    const missing = (view: { container: HTMLElement }) => view.container.querySelector('[data-testid="picture-missing"]')
    const box = missing(first)!
    expect(box.textContent).toBe('a bridge')
    expect(box.getAttribute('role')).toBe('img')
    /* The layout around it stands: the heading and the caption are where they were. */
    expect(first.container.querySelector('h2')?.textContent).toBe('Bridge')
    expect(first.container.querySelector('.slide-caption')?.textContent).toContain('The bridge, 1890')
    /* Drawn again (the strip, the next turn of the slide): no second request. */
    const second = render(<SlideView slide={slide} />)
    expect(second.container.querySelector('img')).toBeNull()
    expect(missing(second)?.textContent).toBe('a bridge')
    /* The same place on screen turned to another slide and back: still no request for the one that failed. */
    second.rerender(<SlideView slide={parseSlide('<!-- layout: image -->\n![there](figures/there.png)')} />)
    expect(second.container.querySelector('img')?.getAttribute('src')).toBe('figures/there.png')
    second.rerender(<SlideView slide={slide} />)
    expect(second.container.querySelector('img')).toBeNull()
    /* With no alt text, the path it was looked for at. */
    const bare = render(<SlideView slide={parseSlide('![](figures/unnamed.png)')} />)
    fireEvent.error(bare.container.querySelector('img')!)
    expect(missing(bare)?.textContent).toBe('figures/unnamed.png')
  })

  test('a picture the door refused because the server started again under this page: the page learns it is older than its server', async () => {
    const { resetServerStanding, serverStanding } = await import('kehikot-module-protocol/client')
    const realFetch = globalThis.fetch
    const asked: { url: string; ticket: string | null }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      asked.push({ url: String(url), ticket: (init.headers as Record<string, string> | undefined)?.['x-module-ticket'] ?? null })
      return Response.json({ ok: false, error: 'That picture was not asked for by this app’s own page.', refused: 'ticket' }, { status: 403 })
    }) as unknown as typeof fetch
    resetServerStanding()
    try {
      /* A picture named as written, with no project, is not this app's door: nothing is asked. */
      const plain = render(<SlideView slide={parseSlide('![elsewhere](figures/elsewhere.png)')} />)
      fireEvent.error(plain.container.querySelector('img')!)
      expect(asked).toEqual([])

      const slide = parseSlide('![a figure](figures/stale.png)\n\n![another](figures/stale-too.png)')
      const view = render(
        <PictureProject.Provider value="/work/thesis">
          <SlideView slide={slide} />
        </PictureProject.Provider>,
      )
      for (const img of view.container.querySelectorAll('img')) fireEvent.error(img)
      await new Promise((resolve) => setTimeout(resolve, 20))
      /* Asked once for both pictures, of the same door, with the ticket where `ask` can be told it was refused. */
      expect(asked).toHaveLength(1)
      expect(asked[0]!.url).toContain('/api/asset')
      expect(asked[0]!.ticket).not.toBeNull()
      expect(serverStanding()).toBe('stale')
    } finally {
      globalThis.fetch = realFetch
      resetServerStanding()
    }
  })

  test('a quote slide draws a blockquote', () => {
    const view = draw('<!-- layout: quote -->\n> Simplicity is prerequisite for reliability.\n\n— Dijkstra')
    expect(view.querySelector('.slide-quote blockquote')?.textContent).toContain('Simplicity')
    expect(view.textContent).toContain('Dijkstra')
  })

  test('speaker notes are never drawn on the slide', () => {
    const view = draw('## Point\n- a\n\nNotes:\nSay the secret part out loud.')
    expect(view.textContent).toContain('Point')
    expect(view.textContent).not.toContain('secret part')
  })

  test('math is typeset by KaTeX and code is highlighted', () => {
    const view = draw('## Sums\n$E = mc^2$\n\n```js\nconst a = 1\n```')
    expect(view.querySelector('.katex')).not.toBeNull()
    expect(view.querySelector('code.hljs, code .hljs-keyword')).not.toBeNull()
  })

  test('the section chip shows only when asked for', () => {
    const raw = '<!-- section: chapters/2.tex | Bridging the gap -->\n## The problem'
    expect(draw(raw).querySelector('[data-testid="section-chip"]')).toBeNull()
    cleanup()
    expect(draw(raw, { showSection: true }).querySelector('[data-testid="section-chip"]')?.textContent).toContain(
      'Bridging the gap',
    )
  })

  test('the slide is laid out at 1280×720 and scaled, not reflowed', () => {
    const view = draw('## Size')
    const stage = view.querySelector('[data-testid="slide-view"] > div') as HTMLElement
    expect(stage.style.width).toBe('1280px')
    expect(stage.style.height).toBe('720px')
    expect(stage.style.transform).toMatch(/^scale\(/)
  })

  test('a 4:3 deck is 960 wide', () => {
    const view = render(<SlideView slide={parseSlide('## Old')} aspect="4:3" />).container
    expect((view.querySelector('[data-testid="slide-view"] > div') as HTMLElement).style.width).toBe('960px')
  })
})

describe('helpers', () => {
  test('leadingHeading takes a first heading line only', () => {
    expect(leadingHeading('## A\nb')).toEqual({ heading: '## A', rest: 'b' })
    expect(leadingHeading('a\n## B')).toEqual({ heading: null, rest: 'a\n## B' })
  })

  test('project paths are told apart from URLs', () => {
    expect(isProjectPath('figures/a.png')).toBe(true)
    expect(isProjectPath('https://x/a.png')).toBe(false)
    expect(isProjectPath('/abs/a.png')).toBe(false)
    expect(isProjectPath('data:image/png;base64,AA')).toBe(false)
  })
})

describe('citation markers', () => {
  const RAW = '## Results\n- Mean 3.51[^1] after `code[^2]`\nSources:\n[^1]: ch/4.tex | "highest after"'
  const found = {
    label: '1',
    path: 'ch/4.tex',
    quote: 'highest after',
    status: 'holds' as const,
    at: { from: 10, to: 23, line: 3, endLine: 4 },
    count: 1,
  }

  test('are left out where nobody is editing: no marker, no stray [^1]', () => {
    const view = draw(RAW)
    expect(view.querySelector('[data-testid="cite-mark"]')).toBeNull()
    expect(view.textContent).toContain('Mean 3.51 after')
    expect(view.textContent).not.toContain('[^1]')
    /* Inside code a marker is code. */
    expect(view.querySelector('code')?.textContent).toBe('code[^2]')
  })

  test('are drawn in the editor, say where they hold, and point when pressed', () => {
    const pressed: string[] = []
    const view = render(
      <SlideView slide={parseSlide(RAW)} cite={{ found: new Map([['1', found]]), lit: new Set(['1']), onCite: (l) => pressed.push(l) }} />,
    ).container
    const mark = view.querySelector('[data-testid="cite-mark"]') as HTMLButtonElement
    expect(mark.textContent).toBe('1')
    expect(mark.dataset.status).toBe('holds')
    expect(mark.title).toContain('ch/4.tex, lines 3–4')
    expect(mark.className).toContain('ring-2')
    mark.click()
    expect(pressed).toEqual(['1'])
  })

  test('a marker whose words are gone is drawn as broken and cannot point', () => {
    const view = render(
      <SlideView slide={parseSlide(RAW)} cite={{ found: new Map([['1', { ...found, status: 'adrift' as const, at: null }]]), lit: new Set(), onCite: () => {} }} />,
    ).container
    const mark = view.querySelector('[data-testid="cite-mark"]') as HTMLButtonElement
    expect(mark.dataset.status).toBe('adrift')
    expect(mark.disabled).toBe(true)
    expect(mark.title).toContain('no longer has these words')
  })
})
