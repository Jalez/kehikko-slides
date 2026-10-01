import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'

import { parseSlide } from '../deck/format.ts'
import { assetUrl, isProjectPath } from '../src/slides/markdown.tsx'
import { SlideView, leadingHeading } from '../src/slides/slide-view.tsx'

afterEach(cleanup)

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
