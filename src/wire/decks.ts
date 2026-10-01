import type {
  ConflictReply,
  CreateDeckReply,
  DeckSummary,
  HistoryEntry,
  HistoryReply,
  ListDecksReply,
  ReadDeckReply,
  Version,
  WatchEvent,
  WriteDeckReply,
} from '../../deck/api.ts'

/**
 * The decks `/api`, as the page calls it — the only file in the page that
 * knows a URL. Everything else takes a `Decks`, so a test hands the screen a
 * fake. Writes carry the ticket printed into the page (see `TICKET` in doors.ts).
 */
const TICKET_HEADER = 'x-module-ticket'

function ticket(): string {
  const text = document.getElementById('ticket')?.textContent ?? '""'
  try {
    return String(JSON.parse(text))
  } catch {
    return ''
  }
}

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
}

async function body<T>(response: Response): Promise<T> {
  const parsed = (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!response.ok || parsed.ok === false) throw new Error(parsed.error ?? `the store answered ${response.status}`)
  return parsed
}

function send(method: string, path: string, payload: unknown): Promise<Response> {
  return fetch(path, {
    method,
    headers: { 'content-type': 'application/json', [TICKET_HEADER]: ticket() },
    body: JSON.stringify(payload),
  })
}

const query = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

export const decks: Decks = {
  async list(project) {
    return (await body<ListDecksReply>(await fetch(`./api/decks?${query({ project })}`))).decks
  },
  async read(project, slug) {
    const reply = await body<ReadDeckReply>(await fetch(`./api/deck?${query({ project, slug })}`))
    return { text: reply.text, version: reply.version }
  },
  async save(project, slug, text, base) {
    const response = await send('PUT', './api/deck', base === undefined ? { project, slug, text } : { project, slug, text, base })
    if (response.status === 409) {
      const conflict = (await response.json()) as ConflictReply
      /* Null on both sides means the deck was deleted while this was being
         typed: not a version to reconcile with, so it is a failure with the
         server's sentence. */
      if (conflict.version === null || conflict.text === null) {
        throw new Error(conflict.error || 'This deck was deleted while it was being edited.')
      }
      return { ok: false, conflict: { version: conflict.version, text: conflict.text } }
    }
    return { ok: true, version: (await body<WriteDeckReply>(response)).version }
  },
  async create(project, title, epic) {
    const payload = epic ? { project, title, epic } : { project, title }
    return (await body<CreateDeckReply>(await send('POST', './api/decks', payload))).slug
  },
  async retitle(project, slug, title) {
    await body(await send('PATCH', './api/deck', { project, slug, title }))
  },
  async remove(project, slug) {
    await body(await send('DELETE', './api/deck', { project, slug }))
  },
  async history(project, slug) {
    return (await body<HistoryReply>(await fetch(`./api/history?${query({ project, slug })}`))).entries
  },
  async undo(project, slug, id) {
    await body(await send('POST', './api/undo', { project, slug, id }))
  },
  watch(project, onChange) {
    if (typeof EventSource === 'undefined') return () => {}
    const source = new EventSource(`./api/watch?${query({ project })}`)
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as WatchEvent
        if (event && typeof event.slug === 'string') onChange(event)
      } catch {
        /* a keep-alive or a line we do not read */
      }
    }
    return () => source.close()
  },
}
