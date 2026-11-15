import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'bun:test'

import type { Attachment } from 'kehikot-module-protocol/client'

import type { AudienceEvent, AudienceState } from '../deck/api.ts'
import { AudienceView, WORDS } from '../src/audience.tsx'
import { AudienceControl, WORDS as CONTROL } from '../src/audience-link.tsx'
import { routeOf } from '../src/routes.ts'
import { fakeDecks } from './fakes.tsx'

afterEach(cleanup)

const STATE: AudienceState = { presenter: true, blank: false, index: 1, count: 3, aspect: '16:9', slide: { layout: 'bullets', body: '## The answer\n- three' } }

/** A stream the test drives: what the page followed, and what to say to it. */
function stream() {
  const run = { path: '', send: (_event: AudienceEvent) => {}, attach: (_now: Attachment) => {}, stopped: 0, follows: 0 }
  const following = (path: string, onEvent: (event: AudienceEvent) => void, options: { onAttachment: (attachment: Attachment) => void }) => {
    run.path = path
    run.follows += 1
    run.send = (event) => act(() => onEvent(event))
    run.attach = (now) => act(() => options.onAttachment(now))
    return () => {
      run.stopped += 1
    }
  }
  return { run, following }
}

const alive = async () => true

describe('the audience page', () => {
  test('is a route of its own, read from the address', () => {
    expect(routeOf('http://slides.kehikot.localhost:4170/audience/abcDEF_-123')).toEqual({ page: 'audience', key: 'abcDEF_-123' })
    expect(routeOf('http://h/audience/k/')).toEqual({ page: 'audience', key: 'k' })
    expect(routeOf('http://h/app')).toEqual({ page: 'screen' })
  })

  test('follows its key on one stream, and shows only the slide it is sent: no notes, no controls', () => {
    const { run, following } = stream()
    const key = 'k'.repeat(32)
    render(<AudienceView linkKey={key} following={following} alive={alive} />)
    expect(run.path).toBe(`/audience/${key}/events`)
    expect(run.follows).toBe(1)
    expect(screen.getByText(WORDS.waiting)).toBeTruthy()

    run.send(STATE)
    expect(screen.getByRole('heading', { name: 'The answer' })).toBeTruthy()
    expect(screen.getByText('three')).toBeTruthy()
    expect(screen.queryByText(WORDS.waiting)).toBeNull()
    /* Nothing to press, nothing to type in, no notes, no timer: it is a slide. */
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryByLabelText('notes')).toBeNull()
    expect(screen.queryByText(/slide \d/i)).toBeNull()
    expect(run.follows).toBe(1)
  })

  test('moves when told to, on the same stream', () => {
    const { run, following } = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={alive} />)
    run.send(STATE)
    run.send({ ...STATE, index: 2, slide: { layout: 'bullets', body: '## The end' } })
    expect(screen.getByRole('heading', { name: 'The end' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'The answer' })).toBeNull()
    expect(run.follows).toBe(1)
  })

  test('is dark around the slide, which is scaled to the deck’s own proportions', () => {
    const { run, following } = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={alive} />)
    run.send({ ...STATE, aspect: '4:3' })
    expect(screen.getByTestId('audience').className).toContain('bg-black')
    expect(screen.getByTestId('slide-view')).toBeTruthy()
  })

  test('a blank screen is black', () => {
    const { run, following } = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={alive} />)
    run.send({ ...STATE, blank: true, slide: null })
    expect(screen.queryByTestId('slide-view')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  test('says "Press F for full screen" until it is full screen, and F asks for it', async () => {
    const { run, following } = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={alive} />)
    run.send(STATE)
    expect(screen.getByTestId('hint').textContent).toBe(WORDS.fullScreen)
    const asked: string[] = []
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: async () => void asked.push('full') })
    fireEvent.keyDown(window, { key: 'f' })
    expect(asked).toEqual(['full'])
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement })
    act(() => void document.dispatchEvent(new Event('fullscreenchange')))
    expect(screen.queryByTestId('hint')).toBeNull()
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
  })

  test('keeps the last slide and says "Presenter disconnected" while the presenter is away, and clears it on return', () => {
    const { run, following } = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={alive} />)
    run.send(STATE)
    expect(screen.queryByTestId('away')).toBeNull()
    run.send({ ...STATE, presenter: false })
    expect(screen.getByTestId('away').textContent).toBe(WORDS.away)
    expect(screen.getByRole('heading', { name: 'The answer' })).toBeTruthy()
    run.send({ ...STATE, index: 2, slide: { layout: 'bullets', body: '## Back' } })
    expect(screen.queryByTestId('away')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Back' })).toBeTruthy()
  })

  test('says "Reconnecting…" while its own stream is down, and asks once whether the link still works', async () => {
    const { run, following } = stream()
    const asked: string[] = []
    render(<AudienceView linkKey={'k'.repeat(32)} following={following} alive={async (key) => (asked.push(key), true)} />)
    run.send(STATE)
    run.attach('detached')
    expect(screen.getByTestId('reconnecting').textContent).toBe(WORDS.reconnecting)
    await waitFor(() => expect(asked).toEqual(['k'.repeat(32)]))
    expect(screen.getByRole('heading', { name: 'The answer' })).toBeTruthy()
    run.attach('attached')
    expect(screen.queryByTestId('reconnecting')).toBeNull()
  })

  test('stops following when the link is over, whether it is told or finds out', async () => {
    const told = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={told.following} alive={alive} />)
    told.run.send(STATE)
    told.run.send({ ended: true, why: 'renewed' })
    expect(screen.getByText(WORDS.renewed)).toBeTruthy()
    expect(told.run.stopped).toBeGreaterThan(0)
    cleanup()

    const found = stream()
    render(<AudienceView linkKey={'k'.repeat(32)} following={found.following} alive={async () => false} />)
    found.run.attach('detached')
    await waitFor(() => expect(screen.getByText(WORDS.over)).toBeTruthy())
  })
})

describe('the presenter’s control', () => {
  const ORIGIN = 'http://slides.kehikot.localhost:4170'

  test('shows the link on the stable address with Copy and Open in browser', async () => {
    const fake = fakeDecks()
    render(<AudienceControl decks={fake.decks} project="/w" slug="defence" origin={ORIGIN} />)
    expect(fake.of('followAudience')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONTROL.open) }))
    const field = screen.getByLabelText('audience link') as HTMLInputElement
    expect(field.value).toBe(`${ORIGIN}/audience/${'k'.repeat(32)}`)
    expect(field.value).toMatch(/\/audience\/[A-Za-z0-9_-]{32}$/)
    const open = screen.getByRole('link', { name: CONTROL.browser }) as HTMLAnchorElement
    expect(open.href).toBe(field.value)
    expect(open.target).toBe('_blank')
    expect(open.rel).toContain('noopener')

    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void written.push(text) } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONTROL.copy) }))
    await waitFor(() => expect(written).toEqual([field.value]))
    expect(screen.getByRole('button', { name: new RegExp(CONTROL.copied) })).toBeTruthy()
  })

  test('is opened with the window, not with the panel, so closing the panel does not tell the audience anything', () => {
    const fake = fakeDecks()
    render(<AudienceControl decks={fake.decks} project="/w" slug="defence" origin={ORIGIN} />)
    expect(fake.of('followAudience')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONTROL.open) }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByLabelText('audience link')).toBeNull()
    expect(fake.of('followAudience')).toHaveLength(1)
  })

  test('says how many windows follow, and a new link replaces the one shown', async () => {
    const fake = fakeDecks()
    render(<AudienceControl decks={fake.decks} project="/w" slug="defence" origin={ORIGIN} />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONTROL.open) }))
    expect(screen.getByTestId('audience-viewers').textContent).toBe(CONTROL.none)
    const before = (screen.getByLabelText('audience link') as HTMLInputElement).value
    fireEvent.click(screen.getByRole('button', { name: new RegExp(CONTROL.renew) }))
    await waitFor(() => expect(fake.of('renewAudience')).toHaveLength(1))
    await waitFor(() => expect((screen.getByLabelText('audience link') as HTMLInputElement).value).not.toBe(before))
    expect((screen.getByLabelText('audience link') as HTMLInputElement).value).toBe(`${ORIGIN}/audience/${'n'.repeat(32)}`)
  })
})
