import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { CitationView } from '../deck/api.ts'
import { Screen } from '../src/app.tsx'
import type { PassageLike } from '../src/follow.ts'
import type { Host } from '../src/wire/use-kehikot.ts'
import { FakeEditor, caretAt, editor, fakeDecks, host, preview } from './fakes.tsx'

afterEach(cleanup)

const CITED = `---
title: Defence
---

# Title

---

## The problem
- one[^1]
- two
Sources:
[^1]: ch/2.tex | "the exact words"
`

const FOUND: CitationView = {
  label: '1',
  path: 'ch/2.tex',
  quote: 'the exact words',
  status: 'holds',
  at: { from: 120, to: 135, line: 7, endLine: 7 },
  count: 1,
}

function drawCited() {
  const sourced: unknown[][] = []
  const fake = fakeDecks(
    {
      citations: async () => [[], [FOUND]],
      source: async (...args) => {
        sourced.push(args)
        return 'Selected\n  source words'
      },
    },
    { text: CITED },
  )
  const asked: { method: string; params: unknown }[] = []
  const request: Host['request'] = async (method, params) => {
    asked.push({ method, params })
    return null
  }
  const at = (passage: PassageLike | null) => (
    <Screen host={host({ request, passage })} decks={fake.decks} editor={FakeEditor} saveDelay={20} publishDelay={5} />
  )
  const view = render(at(null))
  return { fake, asked, sourced, read: (passage: PassageLike | null) => view.rerender(at(passage)) }
}

describe('citations in the editor', () => {
  test('a marker is drawn in the preview and turns the paper to the exact words', async () => {
    const run = drawCited()
    await waitFor(() => expect(editor().value).toBe(CITED))
    caretAt(CITED.indexOf('- two'))
    const mark = await waitFor(() => {
      const one = preview().getByTestId('cite-mark') as HTMLButtonElement
      expect(one.dataset.status).toBe('holds')
      return one
    })
    fireEvent.click(mark)
    await waitFor(() =>
      expect(run.asked.filter((one) => one.method === 'passage.set').map((one) => one.params)).toEqual([
        { passage: { path: '/work/thesis/ch/2.tex', page: null, from: 120, to: 135, quoted: 'the exact words', section: null } },
      ]),
    )
  })

  test('a selection in the paper is cited at the caret’s line, in the source’s own words', async () => {
    const run = drawCited()
    await waitFor(() => expect(editor().value).toBe(CITED))
    const button = () => screen.getByRole('button', { name: /Cite the selection/ }) as HTMLButtonElement
    expect(button().disabled).toBe(true)

    run.read({ path: '/work/thesis/ch/3.tex', from: 40, to: 62, section: null })
    caretAt(CITED.indexOf('- two') + 2)
    await waitFor(() => expect(button().disabled).toBe(false))
    fireEvent.click(button())
    await waitFor(() => expect(editor().value).toContain('- two[^2]\nSources:\n[^1]: ch/2.tex | "the exact words"\n[^2]: ch/3.tex | "Selected source words"'))
    expect(run.sourced[0]).toEqual(['/work/thesis', 'ch/3.tex', 40, 62])
  })

  test('what the paper has selected lights the markers that cite it', async () => {
    const run = drawCited()
    await waitFor(() => expect(editor().value).toBe(CITED))
    caretAt(CITED.indexOf('- two'))
    await waitFor(() => expect(preview().getByTestId('cite-mark').className).not.toContain('ring-2'))
    run.read({ path: '/work/thesis/ch/2.tex', from: 130, to: 140, section: null })
    await waitFor(() => expect(preview().getByTestId('cite-mark').className).toContain('ring-2'))
    expect((screen.getByRole('button', { name: /Cite the selection/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('thumbnails never show a marker', async () => {
    drawCited()
    await waitFor(() => expect(editor().value).toBe(CITED))
    const thumbs = screen.getByRole('navigation', { name: /slides/i })
    expect(thumbs.textContent).not.toContain('[^1]')
    expect(thumbs.querySelector('[data-testid="cite-mark"]')).toBeNull()
  })
})
