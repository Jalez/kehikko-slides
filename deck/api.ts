/**
 * The contract between the slides server (`doors.ts`) and its page
 * (`src/wire/decks.ts`): every path, every request and every answer, said once
 * so the two cannot drift. Types and constants only; nothing here does I/O.
 *
 * Every answer carries `ok`. A refusal is `{ ok: false, error }`, where `error`
 * is a sentence a person can read.
 */

/** The header a write carries the page's ticket in. Reads are not gated. */
export const TICKET_HEADER = 'x-module-ticket'

/** What a deck's file name may be: `<slug>.md` under `.kehikot/slides/`. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/

/** The largest deck this module keeps, in characters. */
export const MAX_DECK_CHARS = 500_000

/** How many undo entries each deck keeps. */
export const HISTORY_PER_DECK = 50

export const PATHS = {
  /** GET ?project — the decks in a project. POST {@link CreateDeck} — a new deck. */
  decks: '/api/decks',
  /** GET ?project&slug — one deck. PUT {@link SaveDeck}, PATCH {@link RetitleDeck}, DELETE {@link DeleteDeck}. */
  deck: '/api/deck',
  /** GET ?project&slug — the undo trail, newest first. */
  history: '/api/history',
  /** POST {@link UndoEntry}. */
  undo: '/api/undo',
  /** GET ?project — server-sent events, one {@link DeckChange} per change to any deck file. */
  watch: '/api/watch',
  /** GET ?project&slug — server-sent events of {@link PresentState}. POST {@link PresentMove}. */
  present: '/api/present',
} as const

export interface Refusal {
  ok: false
  error: string
}

/** One row of the deck list. `updated` is the file's mtime in ms. */
export interface DeckSummary {
  slug: string
  title: string
  epic: string | null
  slides: number
  updated: number
}

/** A deck as stored. `version` is opaque: send it back as `base` when saving. */
export interface DeckFile {
  slug: string
  text: string
  version: string
}

export interface DecksReply {
  ok: true
  /** Most recently changed first. */
  decks: DeckSummary[]
}

export interface DeckReply extends DeckFile {
  ok: true
}

/** PUT /api/deck. With `base`, refused (409, {@link Conflict}) unless the deck is still at that version. */
export interface SaveDeck {
  project: string
  slug: string
  text: string
  base?: string
}

export interface Saved {
  ok: true
  version: string
}

/** 409: somebody else wrote first. `text`/`version` are what is there now (null: the deck is gone). */
export interface Conflict extends Refusal {
  version: string | null
  text: string | null
}

/** POST /api/decks. */
export interface CreateDeck {
  project: string
  title: string
  epic?: string | null
}

export interface Created {
  ok: true
  slug: string
  version: string
}

/** PATCH /api/deck: changes the front-matter title; the slug and file stay. */
export interface RetitleDeck {
  project: string
  slug: string
  title: string
}

/** DELETE /api/deck. */
export interface DeleteDeck {
  project: string
  slug: string
}

export interface Done {
  ok: true
}

/** One agent write, as the history list shows it (the previous text is kept on disk, not sent). */
export interface HistoryEntry {
  id: string
  slug: string
  /** ISO time. */
  at: string
  agent: string
  summary: string
}

export interface HistoryReply {
  ok: true
  /** Newest first. */
  entries: HistoryEntry[]
}

/** POST /api/undo: put the deck back to how it was before entry `id`. */
export interface UndoEntry {
  project: string
  slug: string
  id: string
}

/** `version` is null when the undo removed a deck an agent had created. */
export interface Undone {
  ok: true
  version: string | null
}

/** One event on /api/watch. `version` null: the deck's file is gone. */
export interface DeckChange {
  slug: string
  version: string | null
}

/** Where a talk is. `at` is ms since the epoch of the last move, 0 when nobody has moved yet. */
export interface PresentState {
  slug: string
  index: number
  blank: boolean
  at: number
}

/** POST /api/present. */
export interface PresentMove {
  project: string
  slug: string
  index: number
  blank?: boolean
}
