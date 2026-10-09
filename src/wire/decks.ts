import { answered, ask, follow } from 'kehikot-module-protocol/client'

import type {
  CitationsReply,
  CitationView,
  ConflictReply,
  CreateDeckReply,
  DeckSummary,
  HistoryEntry,
  HistoryReply,
  ListDecksReply,
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
 * write, and a failure is thrown as its sentence: the server's own words, "not
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
  /** Every slide's sources, looked for in their files; indexed like the slides. */
  citations(project: string, slug: string): Promise<CitationView[][]>
  /** The exact words of a project file between two byte offsets. */
  source(project: string, path: string, from: number, to: number): Promise<string>
}

const get = async <T>(path: string, query: Record<string, string>) => answered(await ask<T>(path, { query }))
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
  async citations(project, slug) {
    return (await get<CitationsReply>('./api/citations', { project, slug })).slides
  },
  async source(project, path, from, to) {
    return (await get<SourceReply>('./api/source', { project, path, from: String(from), to: String(to) })).text
  },
}
