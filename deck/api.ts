/**
 * The shapes the slides store and its page speak over `/api`. One file, read
 * by both ends, so a field renamed on one side fails the other's typecheck.
 *
 * `project` is always the project's absolute directory (the host's
 * `projectPath`): that is what the store is partitioned by.
 */

/** A deck's version on disk. Opaque: only ever compared for equality. */
export type Version = string | number

export interface DeckSummary {
  slug: string
  title: string
  epic: string | null
  /** How many slides it has. */
  slides: number
  /** When it was last written, ISO 8601. */
  updated: string
}

/** GET /api/decks?project */
export interface ListDecksReply {
  decks: DeckSummary[]
}

/** GET /api/deck?project&slug */
export interface ReadDeckReply {
  slug: string
  text: string
  version: Version
}

/** PUT /api/deck. `base` is the version the text was edited from; omitted, it overwrites. */
export interface WriteDeckRequest {
  project: string
  slug: string
  text: string
  base?: Version
}
export interface WriteDeckReply {
  version: Version
}
/** PUT /api/deck answered 409: somebody wrote since `base`. What is there now. */
export interface ConflictReply {
  error: string
  version: Version
  text: string
}

/** POST /api/decks */
export interface CreateDeckRequest {
  project: string
  title: string
  epic?: string
}
export interface CreateDeckReply {
  slug: string
}

/** PATCH /api/deck — retitle; the slug (the file) stays. */
export interface RetitleDeckRequest {
  project: string
  slug: string
  title: string
}

/** DELETE /api/deck */
export interface RemoveDeckRequest {
  project: string
  slug: string
}

/** One write an agent made through the MCP door, with what was there before it. */
export interface HistoryEntry {
  id: string
  slug: string
  /** ISO 8601. */
  at: string
  agent: string
  summary: string
}

/** GET /api/history?project&slug */
export interface HistoryReply {
  entries: HistoryEntry[]
}

/** POST /api/undo */
export interface UndoRequest {
  project: string
  slug: string
  id: string
}

/** One event on GET /api/watch?project (server-sent): a deck changed on disk. */
export interface WatchEvent {
  slug: string
  version: Version
}
