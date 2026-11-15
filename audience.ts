import { createHash, randomBytes } from 'node:crypto'

import type { Before } from 'kehikot-module-protocol/serve'

import { AUDIENCE_PREFIX, type AudienceEvent, type AudienceLink, type AudienceState } from './deck/api.ts'
import { parseDeck } from './deck/format.ts'
import { documentsOf } from './host-ask.ts'
import { followTalk, watchDecks } from './live.ts'
import { PICTURE_HEADERS, keyOf, pictureBytes, readDeck } from './store.ts'

/**
 * The audience view: a second window onto a talk that shows the slide and nothing else, at an address a
 * person can paste into any browser on this machine, and follows the presenter.
 *
 * ## What it is
 *
 * A SESSION is one deck being presented, and it has one key. The presenter's window opens a stream
 * (`PATHS.audience`, behind the page's ticket) and is handed the link; every audience page opens
 * `/audience/<key>/events` and is sent the presenter's place at once, and again on every move. What is
 * sent is the shown slide's layout and Markdown and the deck's shape: never the notes, the sources, the
 * section links or the project's folder. The presenter's position is what `live.ts` already holds for a
 * talk (`followTalk`), which is also what keeps the stage and the presenter view in step, so the
 * audience is one more follower of it and nothing here moves a talk.
 *
 * ## What keeps it private
 *
 * - The key is 24 random bytes in the address. It is looked up by its hash, so nothing about a key that
 *   is nearly right is learnt from how long the answer took. It is kept in memory only: a restart ends
 *   every link, and a new link ends the one before (`renew`).
 * - It works while the presenter's window is open and for `AWAY.endsMs` after it closes; then it is over.
 *   In between, a page keeps the last slide and says the presenter is away, and goes on when they return.
 * - The door is read-only: GET and HEAD, nothing else, and nothing it answers to a GET changes anything.
 *   It is asked before the protocol's doors, so it carries its own `frame-ancestors 'none'`: no other
 *   site can frame it. A request from another site's page is refused (`asker`).
 * - The server listens on loopback only (`run`, `serves`). Reaching it from a browser goes through the
 *   host's frame address for this module, which is stable across restarts, never this module's port.
 */

/**
 * `graceMs`: how long after the presenter's window closed it is still taken to be there (a reload, a moved window).
 * `endsMs`: how long the presenter may then stay away before the link is over. Tests shorten both.
 */
export const AWAY = { graceMs: 3_000, endsMs: 30 * 60_000 }

/** How often an open stream is sent a comment so nothing in between closes it. */
export const BEAT_MS = 25_000

/** How many audience pages may follow one talk. More are refused, so a loop of reconnects cannot grow without end. */
export const MOST_VIEWERS = 64

/** One presenter window following a session: what it is told, and the session it follows now (a new link moves it). */
interface PresenterWindow {
  hear(link: AudienceLink): void
  session: Session
}

interface Session {
  key: string
  hash: string
  /** The project folder the host vouched for, and its key (`keyOf`). */
  project: string
  root: string
  slug: string
  /** Whether the audience has been told the presenter is there. */
  present: boolean
  away: ReturnType<typeof setTimeout> | null
  over: ReturnType<typeof setTimeout> | null
  pages: Set<(event: AudienceEvent) => void>
  /** The presenter's windows with the stream open. */
  windows: Set<PresenterWindow>
  /** What the pages were last told, so a repeat is not sent. */
  told: string
  talk: { index: number; blank: boolean }
  stop: (() => void) | null
}

const sessions = new Map<string, Session>()
const byDeck = new Map<string, Session>()

const hashOf = (key: string): string => createHash('sha256').update(key).digest('hex')
const deckKey = (root: string, slug: string): string => `${keyOf(root)}\0${slug}`

/** The key's shape, so a path that cannot be one is not even looked up. */
const KEY = /^[A-Za-z0-9_-]{32}$/

function find(key: string): Session | null {
  return KEY.test(key) ? (sessions.get(hashOf(key)) ?? null) : null
}

/* ------------------------------------------------------------------ *
 * What a page is told
 * ------------------------------------------------------------------ */

/** The state of a session now: the slide the talk is on, from the deck as it is on disk. */
export function stateOf(session: Pick<Session, 'project' | 'slug' | 'talk' | 'present'>): AudienceState {
  const read = readDeck(session.project, session.slug)
  const deck = read.ok ? parseDeck(read.value.text, session.slug) : null
  const count = deck?.slides.length ?? 0
  const index = count === 0 ? 0 : Math.min(Math.max(session.talk.index, 0), count - 1)
  const slide = deck?.slides[index]
  return {
    presenter: session.present,
    blank: session.talk.blank,
    index,
    count,
    aspect: deck?.aspect ?? '16:9',
    /* Only what is drawn. A blank slide sends nothing, so a page cannot be made to show what the presenter hid. */
    slide: slide && !session.talk.blank ? { layout: slide.layout, body: slide.body } : null,
  }
}

function tell(session: Session): void {
  const state = stateOf(session)
  const text = JSON.stringify(state)
  if (text === session.told) return
  session.told = text
  for (const page of session.pages) page(state)
}

/** Follow the talk and the deck file while somebody is looking at the audience page, and not otherwise. */
function attach(session: Session): void {
  if (session.stop) return
  const off = followTalk(session.root, session.slug, (talk) => {
    session.talk = { index: talk.index, blank: talk.blank }
    tell(session)
  })
  const decks = watchDecks(session.project, (change) => {
    if (change.slug === session.slug) tell(session)
  })
  session.stop = () => {
    off()
    if (decks.ok) decks.value()
  }
}

function detach(session: Session): void {
  session.stop?.()
  session.stop = null
}

function link(session: Session): AudienceLink {
  return { path: `${AUDIENCE_PREFIX}${session.key}`, viewers: session.pages.size }
}

function tellPresenters(session: Session): void {
  const said = link(session)
  for (const window of session.windows) window.hear(said)
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

function end(session: Session, why: 'renewed' | 'over'): void {
  if (sessions.get(session.hash) === session) sessions.delete(session.hash)
  if (byDeck.get(deckKey(session.root, session.slug)) === session) byDeck.delete(deckKey(session.root, session.slug))
  if (session.away) clearTimeout(session.away)
  if (session.over) clearTimeout(session.over)
  session.away = session.over = null
  const pages = [...session.pages]
  for (const page of pages) page({ ended: true, why })
  session.pages.clear()
  detach(session)
}

function make(project: string, slug: string): Session {
  const key = randomBytes(24).toString('base64url')
  const root = project
  const session: Session = {
    key,
    hash: hashOf(key),
    project,
    root,
    slug,
    present: false,
    away: null,
    over: null,
    pages: new Set(),
    windows: new Set(),
    told: '',
    talk: { index: 0, blank: false },
    stop: null,
  }
  sessions.set(session.hash, session)
  byDeck.set(deckKey(root, slug), session)
  return session
}

/** The session for a deck, made when there is none. `root` is the project folder as `projectRoot` spells it. */
function sessionFor(root: string, slug: string): Session {
  return byDeck.get(deckKey(root, slug)) ?? make(root, slug)
}

/**
 * The presenter's window opens its stream for a deck: it is handed the link (the one already made, or a new
 * one), and told again whenever the link or the number of pages following it changes. The audience is told the
 * presenter is there. Returns what to call when the window goes. A window that reloads is away for less than
 * `AWAY.graceMs` and the audience is told nothing.
 */
export function presenting(root: string, slug: string, hear: (link: AudienceLink) => void): () => void {
  const session = sessionFor(root, slug)
  const window: PresenterWindow = { hear, session }
  if (session.away) clearTimeout(session.away)
  if (session.over) clearTimeout(session.over)
  session.away = session.over = null
  session.windows.add(window)
  if (!session.present) {
    session.present = true
    tell(session)
  }
  hear(link(session))
  let left = false
  return () => {
    if (left) return
    left = true
    const now = window.session
    now.windows.delete(window)
    if (now.windows.size > 0) return
    now.away = setTimeout(() => {
      now.away = null
      now.present = false
      tell(now)
      now.over = setTimeout(() => end(now, 'over'), AWAY.endsMs)
      now.over.unref?.()
    }, AWAY.graceMs)
    now.away.unref?.()
  }
}

/**
 * A new link for a deck, and the old one ends: its pages are told so and close. The presenter windows that
 * were following the old one are handed the new one. Used when the person thinks the link has got out.
 */
export function renew(root: string, slug: string): AudienceLink {
  const was = byDeck.get(deckKey(root, slug))
  const made = make(root, slug)
  if (was) {
    made.talk = was.talk
    made.present = was.present
    for (const window of was.windows) {
      window.session = made
      made.windows.add(window)
    }
    was.windows.clear()
    end(was, 'renewed')
    tellPresenters(made)
  }
  return link(made)
}

/** Whether a link of this key works, for tests and the health of the door. */
export function working(key: string): boolean {
  return find(key) !== null
}

/** How many links are alive; for tests. */
export function linksAlive(): number {
  return sessions.size
}

/** End every link and let go of everything watched (a server that stops, and the tests). */
export function endAll(): void {
  for (const session of [...sessions.values()]) end(session, 'over')
}

/* ------------------------------------------------------------------ *
 * The door
 * ------------------------------------------------------------------ */

const SHAPE = /^\/audience\/([^/]+)(?:\/(events|alive|asset))?\/?$/

/** What every answer under `/audience/` says, whatever it is: no other site frames it, nothing is kept, nobody is told where it came from. */
const FENCE: Record<string, string> = {
  'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
}

const TEXT = { ...FENCE, 'content-type': 'text/plain; charset=utf-8' }

const NOT_ACTIVE = 'This link is not active. Ask the presenter for a new one.\n'

const frame = (event: AudienceEvent): string => `data: ${JSON.stringify(event)}\n\n`

export interface AudienceDoorOptions {
  /**
   * The page document for an address: the module's own, built or served by Vite, with NO ticket in it. The
   * audience page is handed nothing it could write with.
   */
  document(url: URL): Promise<string>
}

/** The audience door, for `run({ before })` and Vite's `beforeHandler`. `undefined` for any other path. */
export function audienceDoor(options: AudienceDoorOptions): Before {
  return async (request, { asker, url }) => {
    const shape = SHAPE.exec(url.pathname)
    if (!shape) return undefined
    const method = request.method.toUpperCase()
    /* Read-only, as a door: nothing a page, a program or a person sends here changes anything, so there is nothing to forge. */
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('This address is for watching. It takes nothing.\n', { status: 405, headers: { ...TEXT, allow: 'GET, HEAD' } })
    }
    /* A page on another site asking for it (an image, a script, a stream) is not the audience's own page. */
    if (asker === 'elsewhere') return new Response('Not here.\n', { status: 403, headers: TEXT })
    const session = find(shape[1]!)
    if (!session) return new Response(NOT_ACTIVE, { status: 404, headers: TEXT })
    const what = shape[2] ?? 'page'

    if (what === 'alive') return new Response(null, { status: 200, headers: FENCE })

    if (what === 'page') {
      const html = await options.document(url).catch(() => null)
      if (html === null) return new Response('The page is not ready yet. Try again in a moment.\n', { status: 503, headers: { ...TEXT, 'retry-after': '2' } })
      return new Response(method === 'HEAD' ? null : html, { status: 200, headers: { ...FENCE, 'content-type': 'text/html; charset=utf-8' } })
    }

    if (what === 'asset') {
      const path = url.searchParams.get('path') ?? ''
      const documents = (await documentsOf(session.project))?.folder ?? null
      const picture = pictureBytes(session.project, path, documents)
      if (!picture) return new Response('There is no such picture.\n', { status: 404, headers: TEXT })
      return new Response(picture.bytes as BodyInit, { status: 200, headers: { ...PICTURE_HEADERS, ...FENCE, 'cache-control': 'private, max-age=60', 'content-type': picture.type } })
    }

    /* events */
    if (session.pages.size >= MOST_VIEWERS) return new Response('Too many windows are following this talk.\n', { status: 503, headers: { ...TEXT, 'retry-after': '5' } })
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { ...FENCE, 'content-type': 'text/event-stream; charset=utf-8' } })
    const bytes = new TextEncoder()
    let pipe: ReadableStreamDefaultController<Uint8Array> | null = null
    let beat: ReturnType<typeof setInterval> | null = null
    let gone = false
    const send = (text: string) => {
      try {
        pipe?.enqueue(bytes.encode(text))
      } catch {
        /* The reader has gone; `leave` is on its way. */
      }
    }
    const hear = (event: AudienceEvent) => {
      send(frame(event))
      if ('ended' in event && event.ended) leave()
    }
    const leave = () => {
      if (gone) return
      gone = true
      if (beat !== null) clearInterval(beat)
      session.pages.delete(hear)
      if (session.pages.size === 0) detach(session)
      tellPresenters(session)
      try {
        pipe?.close()
      } catch {
        /* Already closed by the reader. */
      }
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        pipe = controller
        /* A page that was cut off asks again in two seconds, which is soon enough to look like nothing happened. */
        send('retry: 2000\n\n: open\n\n')
        attach(session)
        /* Whatever the page missed: the whole state, from the deck as it is now, whether it is the first time or the fifth. */
        const state = stateOf(session)
        session.told = JSON.stringify(state)
        send(frame(state))
        session.pages.add(hear)
        tellPresenters(session)
        beat = setInterval(() => send(': beat\n\n'), BEAT_MS)
        beat.unref?.()
        if (request.signal.aborted) leave()
        else request.signal.addEventListener('abort', leave)
      },
      cancel: leave,
    })
    return new Response(body, { status: 200, headers: { ...FENCE, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' } })
  }
}
