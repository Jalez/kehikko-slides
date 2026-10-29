import { answered, ask, follow, subscribe } from 'kehikot-module-protocol/client'

import type {
  CitationsReply,
  CitationView,
  ConflictReply,
  CreateDeckReply,
  DeckSummary,
  HistoryEntry,
  HistoryReply,
  ListDecksReply,
  PointerSaid,
  PointerState,
  PresentState,
  ReadDeckReply,
  SourceReply,
  Version,
  WatchEvent,
  WriteDeckReply,
} from '../../deck/api.ts'

/**
 * The decks `/api`, as the page calls it — the only file in the page that
 * knows a URL. Everything else takes a `Decks`, so a test hands the screen a
 * fake. The protocol's `ask` carries the ticket printed into the page on every
 * write, and here on every read, and a failure is thrown as its sentence: the server's own words, "not
 * answering", or "this page is older than its server" (and then it reloads).
 */
/** What a save came to: written at a new version, or refused because somebody wrote first. */
export type SaveResult = { ok: true; version: Version } | { ok: false; conflict: { version: Version; text: string } }

export interface Decks {
  list(project: string): Promise<DeckSummary[]>
  read(project: string, slug: string): Promise<{ text: string; version: Version }>
  /** `base` omitted overwrites whatever is there. */
  save(project: string, slug: string, text: string, base?: Version): Promise<SaveResult>
  create(project: string, title: string, epic?: string | null): Promise<string>
  retitle(project: string, slug: string, title: string): Promise<void>
  remove(project: string, slug: string): Promise<void>
  history(project: string, slug: string): Promise<HistoryEntry[]>
  undo(project: string, slug: string, id: string): Promise<void>
  /** Calls `onChange` whenever a deck in the project changes on disk. Returns the unsubscribe. */
  watch(project: string, onChange: (event: WatchEvent) => void): () => void
  /** Say where a talk is now, for every window following it. */
  present(project: string, slug: string, index: number, blank: boolean): Promise<void>
  /** Calls `onState` with where a talk is, at once and on every move. Returns the unsubscribe. */
  followTalk(project: string, slug: string, onState: (state: PresentState) => void): () => void
  /**
   * Calls `onPoint` with the slide the deck was last pointed at from outside, at once and on every pointing.
   * `presenting` tells the door this page is giving a talk: it is counted and not turned. Returns the unsubscribe.
   */
  followPointer(project: string, slug: string, onPoint: (state: PointerState) => void, presenting: boolean): () => void
  /** Tell the door what this page did with the pointing made at `at`, so its caller is told what happened. */
  pointed(project: string, slug: string, at: number, did: PointerSaid['did'], hidden: boolean): Promise<void>
  /** Every slide's sources, looked for in their files; indexed like the slides. */
  citations(project: string, slug: string): Promise<CitationView[][]>
  /**
   * Calls `onChange` when a file the deck's slides cite changed: once as the stream opens (and again
   * each time it reopens: after a drop, or when the page is shown again), then at every change.
   * Never on a clock, and closed while the page is hidden. Returns the unsubscribe.
   */
  citationsChanged(project: string, slug: string, onChange: () => void): () => void
  /** The exact words of a project file between two byte offsets. */
  source(project: string, path: string, from: number, to: number): Promise<string>
  /**
   * Where a project is now: the folder the host has it in, which is not `project` when that folder was renamed
   * or moved since. `projectId`, when the window was opened with one, must be the id of the project there. Rejects
   * with an `AskFailed` whose `status` is 404 when the folder is no longer that project, and with another when
   * nothing answered.
   */
  where(project: string, projectId: string | null): Promise<{ project: string }>
}

/* The reads carry the ticket too: the doors under /api/ answer only this app's own page. */
const get = async <T>(path: string, query: Record<string, string>) => answered(await ask<T>(path, { query, ticket: true }))
const send = async <T>(method: string, path: string, body: unknown) => answered(await ask<T>(path, { method, body }))

export const decks: Decks = {
  async list(project) {
    return (await get<ListDecksReply>('./api/decks', { project })).decks
  },
  async read(project, slug) {
    const reply = await get<ReadDeckReply>('./api/deck', { project, slug })
    return { text: reply.text, version: reply.version }
  },
  async save(project, slug, text, base) {
    const saved = await ask<WriteDeckReply>('./api/deck', {
      method: 'PUT',
      body: base === undefined ? { project, slug, text } : { project, slug, text, base },
    })
    if (!saved.ok && saved.status === 409) {
      const conflict = saved.body as ConflictReply
      if (conflict.version === null || conflict.text === null) {
        throw new Error(conflict.error || 'This deck was deleted while it was being edited.')
      }
      return { ok: false, conflict: { version: conflict.version, text: conflict.text } }
    }
    return { ok: true, version: answered(saved).version }
  },
  async create(project, title, epic) {
    const payload = epic ? { project, title, epic } : { project, title }
    return (await send<CreateDeckReply>('POST', './api/decks', payload)).slug
  },
  async retitle(project, slug, title) {
    await send('PATCH', './api/deck', { project, slug, title })
  },
  async remove(project, slug) {
    await send('DELETE', './api/deck', { project, slug })
  },
  async history(project, slug) {
    return (await get<HistoryReply>('./api/history', { project, slug })).entries
  },
  async undo(project, slug, id) {
    await send('POST', './api/undo', { project, slug, id })
  },
  /* `follow` reconnects by itself, including after the server restarts. */
  watch(project, onChange) {
    return follow<WatchEvent>('./api/watch', (event) => event && typeof event.slug === 'string' && onChange(event), {
      query: { project },
    })
  },
  async present(project, slug, index, blank) {
    await send('POST', './api/present', { project, slug, index, blank })
  },
  followTalk(project, slug, onState) {
    return follow<PresentState>('./api/present', (state) => state && typeof state.index === 'number' && onState(state), {
      query: { project, slug },
    })
  },
  followPointer(project, slug, onPoint, presenting) {
    return follow<PointerState>('./api/pointer', (state) => state && typeof state.index === 'number' && onPoint(state), {
      query: presenting ? { project, slug, presenting: '1' } : { project, slug },
    })
  },
  async pointed(project, slug, at, did, hidden) {
    await send('POST', './api/pointer', { project, slug, at, did, hidden } satisfies PointerSaid)
  },
  async citations(project, slug) {
    return (await get<CitationsReply>('./api/citations', { project, slug })).slides
  },
  citationsChanged(project, slug, onChange) {
    return subscribe('./api/citations/events', () => onChange(), { query: { project, slug }, probe: true })
  },
  async where(project, projectId) {
    const reply = await get<{ project: string }>('./api/where', projectId ? { project, projectId } : { project })
    return { project: reply.project }
  },
  async source(project, path, from, to) {
    return (await get<SourceReply>('./api/source', { project, path, from: String(from), to: String(to) })).text
  },
}
