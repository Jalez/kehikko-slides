import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, waitFor } from '@testing-library/react'

import { DeckEditor } from '../src/editor/deck-editor.tsx'

/**
 * The real editor, and the keyboard.
 *
 * A jump puts the caret somewhere and scrolls to it. It used to take focus as
 * well, every time — so a part picked in the host's bar, which moves the deck
 * to that part's first slide, pulled the keyboard into this frame and the
 * host's picker closed while the person was still picking. A jump takes focus
 * only when it says the person made it (`focus`).
 */

afterEach(cleanup)

const TEXT = '# One\n\n---\n\n## Two\n\n---\n\n## Three\n'
const noop = () => {}
const inEditor = () => document.activeElement?.closest('.cm-editor') != null

test('a jump from the canvas moves the caret and leaves the keyboard where it was; the person’s own takes it', async () => {
  const outside = document.createElement('button')
  document.body.appendChild(outside)
  outside.focus()
  const carets: number[] = []
  const draw = (jump: { at: number; nonce: number; focus?: boolean } | null) => (
    <DeckEditor value={TEXT} onChange={noop} onCaret={(at) => carets.push(at)} jump={jump} theme="light" />
  )
  const view = render(draw(null))
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
  expect(document.activeElement).toBe(outside)

  /* The canvas moved the deck: the caret goes, the focus does not. */
  view.rerender(draw({ at: TEXT.indexOf('## Two'), nonce: 1, focus: false }))
  await waitFor(() => expect(carets.at(-1)).toBe(TEXT.indexOf('## Two')))
  expect(document.activeElement).toBe(outside)
  expect(inEditor()).toBe(false)

  /* A jump that does not say is not the person's. */
  view.rerender(draw({ at: TEXT.indexOf('## Three'), nonce: 2 }))
  await waitFor(() => expect(carets.at(-1)).toBe(TEXT.indexOf('## Three')))
  expect(document.activeElement).toBe(outside)

  /* The person pressed a thumbnail: now the keyboard is theirs, in the Markdown. */
  view.rerender(draw({ at: TEXT.indexOf('## Two'), nonce: 3, focus: true }))
  await waitFor(() => expect(inEditor()).toBe(true))
  outside.remove()
})
