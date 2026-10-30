import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useRef } from 'react'

import { slideKept } from '../deck/format.ts'
import { Screen } from '../src/app.tsx'
import type { EditorProps } from '../src/editor/deck-editor.tsx'
import { PresenterView } from '../src/presenter.tsx'
import { fakeDecks, host, pause, press } from './fakes.tsx'

afterEach(cleanup)

const deck = (...heads: string[]) => `---\ntitle: Long\n---\n\n${heads.map((h) => `## ${h}\n- body of ${h}`).join('\n\n---\n\n')}\n`
const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
const BASE = deck(...NAMES)

/**
 * CodeMirror as it behaves when the document is replaced from outside: the caret it held is remapped to the start
 * of the text (and reported), unless the change was typed. A jump puts the caret where asked and reports it.
 */
function MappingEditor({ value, onChange, onCaret, jump }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const typed = useRef<string | null>(null)
  const seen = useRef(value)
  useEffect(() => {
    if (value === seen.current) return
    seen.current = value
    if (typed.current === value) return
    if (ref.current) ref.current.setSelectionRange(0, 0)
    onCaret(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  useEffect(() => {
    if (!jump || !ref.current) return
    ref.current.setSelectionRange(jump.at, jump.at)
    onCaret(jump.at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump])
  return (
    <textarea
      ref={ref}
      aria-label="deck markdown"
      value={value}
      onChange={(event) => {
        typed.current = event.target.value
        onChange(event.target.value)
      }}
      onSelect={(event) => onCaret(event.currentTarget.selectionStart)}
    />
  )
}

const position = () => screen.getByTestId('position').textContent
const heading = () => within(screen.getByRole('region', { name: 'preview' })).getAllByRole('heading')[0]?.textContent

async function openAt(text: string, slide: number) {
  const fake = fakeDecks({}, { text })
  render(<Screen host={host()} decks={fake.decks} editor={MappingEditor} saveDelay={20} />)
  await waitFor(() => expect(position()).toBe(`1 / ${NAMES.length}`))
  fireEvent.click(screen.getByRole('button', { name: `slide ${slide + 1}` }))
  await waitFor(() => expect(position()).toContain(`${slide + 1} /`))
  return fake
}

/** The deck is written elsewhere and the watch says so. */
async function change(fake: ReturnType<typeof fakeDecks>, text: string) {
  fake.disk.text = text
  fake.disk.version = `v${Number(String(fake.disk.version).slice(1)) + 1}`
  fake.emit({ slug: 'defence', version: fake.disk.version } as never)
  await pause(30)
}

describe('the slide in front stays through a change from outside', () => {
  test('an edit to the current slide', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, BASE.replace('body of Five', 'body of Five, mended'))
    expect(position()).toBe('5 / 7')
    expect(heading()).toBe('Five')
  })

  test('an edit to an earlier slide', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, BASE.replace('body of Two', 'body of Two, with a much longer sentence than before'))
    expect(position()).toBe('5 / 7')
    expect(heading()).toBe('Five')
  })

  test('a slide added before follows the slide', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck('One', 'New', ...NAMES.slice(1)))
    expect(position()).toBe('6 / 8')
    expect(heading()).toBe('Five')
  })

  test('a slide added after leaves it', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck(...NAMES, 'Eight'))
    expect(position()).toBe('5 / 8')
    expect(heading()).toBe('Five')
  })

  test('the current slide deleted goes to the nearest remaining one', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck(...NAMES.filter((n) => n !== 'Five')))
    expect(position()).toBe('5 / 6')
    expect(heading()).toBe('Six')
  })

  test('the last slide deleted while on it goes to the new last', async () => {
    const fake = await openAt(BASE, 6)
    await change(fake, deck(...NAMES.slice(0, 6)))
    expect(position()).toBe('6 / 6')
  })

  test('a slide before deleted follows the slide', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck(...NAMES.filter((n) => n !== 'Two')))
    expect(position()).toBe('4 / 6')
    expect(heading()).toBe('Five')
  })

  test('presenting stays on the slide too, and the keys still step', async () => {
    const fake = await openAt(BASE, 4)
    press('present')
    await change(fake, deck('One', 'New', ...NAMES.slice(1)))
    expect(screen.getByTestId('stage').textContent).toContain('Five')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByTestId('stage').textContent).toContain('Six'))
  })

  test('navigating by hand still moves, after a change', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck(...NAMES, 'Eight'))
    fireEvent.click(screen.getByRole('button', { name: 'slide 2' }))
    await waitFor(() => expect(position()).toBe('2 / 8'))
    fireEvent.click(screen.getByRole('button', { name: 'next slide' }))
    await waitFor(() => expect(position()).toBe('3 / 8'))
  })

  test('a slide pointed at from outside still moves it', async () => {
    const fake = await openAt(BASE, 4)
    await change(fake, deck(...NAMES, 'Eight'))
    fake.point(1, 9)
    await waitFor(() => expect(position()).toBe('2 / 8'))
  })
})

describe('the presenter window stays too', () => {
  test('through an edit, an add before and a delete before', async () => {
    const fake = fakeDecks({}, { text: BASE })
    render(<PresenterView project="/work/thesis" slug="defence" decks={fake.decks} />)
    await screen.findByRole('region', { name: 'notes' })
    await fake.talk({ index: 4, blank: false, at: 5 })
    const where = () => screen.getByTestId('presenter-position').textContent
    await waitFor(() => expect(where()).toBe('slide 5 / 7'))
    await change(fake, deck('One', 'New', ...NAMES.slice(1)))
    await waitFor(() => expect(where()).toBe('slide 6 / 8'))
    await change(fake, deck(...NAMES.filter((n) => n !== 'Two')))
    await waitFor(() => expect(where()).toBe('slide 4 / 6'))
    await change(fake, deck(...NAMES.filter((n) => n !== 'Two').map((n) => (n === 'Five' ? 'Five!' : n))))
    await waitFor(() => expect(where()).toBe('slide 4 / 6'))
  })
})

describe('slideKept', () => {
  const at = (before: string[], after: string[], index: number) => slideKept(deck(...before), deck(...after), index)
  test('edit, add, remove', () => {
    expect(at(NAMES, NAMES.map((n) => (n === 'Five' ? 'Five!' : n)), 4)).toBe(4)
    expect(at(NAMES, ['One', 'X', ...NAMES.slice(1)], 4)).toBe(5)
    expect(at(NAMES, NAMES.slice(1), 4)).toBe(3)
    expect(at(NAMES, NAMES.filter((n) => n !== 'Five'), 4)).toBe(4)
    expect(at(NAMES, NAMES.slice(0, 2), 4)).toBe(1)
  })
})
