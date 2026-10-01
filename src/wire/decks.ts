/**
 * The slides server's `/api`, as the page calls it. Relative paths, because the
 * page and the store are one origin. Every write carries the ticket printed
 * into the page (see `TICKET` in doors.ts). The shapes are `deck/api.ts`, which
 * the server answers from too.
 */
import {
  PATHS,
  TICKET_HEADER,
  type Conflict,
  type Created,
  type DeckChange,
  type DeckFile,
  type DeckReply,
  type DecksReply,
  type DeckSummary,
  type HistoryEntry,
  type HistoryReply,
  type PresentState,
  type Saved,
  type Undone,
} from '../../deck/api.ts'

function ticket(): string {
  const text = document.getElementById('ticket')?.textContent ?? '""'
  try {
    return String(JSON.parse(text))
  } catch {
    return ''
  }
}

/** A refusal from the server, carrying its sentence and HTTP status. */
export class DeckError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** A save refused because the deck changed underneath: what is there now. */
export class DeckConflict extends DeckError {
  constructor(
    message: string,
    /** The deck's current version, or null when it was deleted. */
    readonly version: string | null,
    /** The deck's current text, or null when it was deleted. */
    readonly text: string | null,
  ) {
    super(message, 409)
  }
}

const url = (path: string, query: Record<string, string>) => `.${path}?${new URLSearchParams(query)}`

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (response.status === 409) {
    const conflict = body as Conflict
    throw new DeckConflict(conflict.error ?? 'The deck changed since it was opened.', conflict.version ?? null, conflict.text ?? null)
  }
  if (!response.ok || body.ok === false) throw new DeckError(body.error ?? `The slides server answered ${response.status}.`, response.status)
  return body as T
}

async function write<T>(method: string, path: string, body: object): Promise<T> {
  return json<T>(
    await fetch(`.${path}`, {
      method,
      headers: { 'content-type': 'application/json', [TICKET_HEADER]: ticket() },
      body: JSON.stringify(body),
    }),
  )
}

export interface Decks {
  list(project: string): Promise<DeckSummary[]>
  read(project: string, slug: string): Promise<DeckFile>
  /** Resolves to the new version; rejects with {@link DeckConflict} when `base` is stale. */
  save(project: string, slug: string, text: string, base?: string): Promise<string>
  /** Resolves to the new deck's slug. */
  create(project: string, title: string, epic?: string | null): Promise<string>
  retitle(project: string, slug: string, title: string): Promise<string>
  remove(project: string, slug: string): Promise<void>
  history(project: string, slug: string): Promise<HistoryEntry[]>
  /** Resolves to the deck's version after the undo, null if it removed the deck. */
  undo(project: string, slug: string, id: string): Promise<string | null>
  present(project: string, slug: string, index: number, blank?: boolean): Promise<void>
}

export const decks: Decks = {
  async list(project) {
    return (await json<DecksReply>(await fetch(url(PATHS.decks, { project })))).decks
  },
  async read(project, slug) {
    const { text, version } = await json<DeckReply>(await fetch(url(PATHS.deck, { project, slug })))
    return { slug, text, version }
  },
  async save(project, slug, text, base) {
    return (await write<Saved>('PUT', PATHS.deck, { project, slug, text, ...(base ? { base } : {}) })).version
  },
  async create(project, title, epic) {
    return (await write<Created>('POST', PATHS.decks, { project, title, ...(epic ? { epic } : {}) })).slug
  },
  async retitle(project, slug, title) {
    return (await write<Saved>('PATCH', PATHS.deck, { project, slug, title })).version
  },
  async remove(project, slug) {
    await write('DELETE', PATHS.deck, { project, slug })
  },
  async history(project, slug) {
    return (await json<HistoryReply>(await fetch(url(PATHS.history, { project, slug })))).entries
  },
  async undo(project, slug, id) {
    return (await write<Undone>('POST', PATHS.undo, { project, slug, id })).version
  },
  async present(project, slug, index, blank = false) {
    await write('POST', PATHS.present, { project, slug, index, blank })
  },
}

function listen<T>(path: string, query: Record<string, string>, on: (event: T) => void): () => void {
  const source = new EventSource(url(path, query))
  source.onmessage = (message) => {
    try {
      on(JSON.parse(String(message.data)) as T)
    } catch {
      /* Not an event of ours. */
    }
  }
  /* EventSource reconnects by itself after a dropped line; closing is ours to do. */
  return () => source.close()
}

/** Be told whenever any deck in the project changes, by any path. Returns the function that stops it. */
export function watchDecks(project: string, on: (change: DeckChange) => void): () => void {
  return listen(PATHS.watch, { project }, on)
}

/** Follow a talk: the current state at once, then every move. Returns the function that stops it. */
export function followTalk(project: string, slug: string, on: (state: PresentState) => void): () => void {
  return listen(PATHS.present, { project, slug }, on)
}
