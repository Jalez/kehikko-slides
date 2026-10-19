import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { kehikotDir, moduleDir, projectFile, projectKey, readProjectFile, resolveSource, within, type CitationView } from 'kehikot-module-protocol'

import { HISTORY_PER_DECK, MAX_DECK_CHARS, SLUG, type DeckFile, type DeckSummary, type HistoryEntry } from './deck/api.ts'
import { emptySlide, parseDeck, retitle, serialiseDeck, slugFor } from './deck/format.ts'
import { ID } from './manifest.ts'

/**
 * This module's material, kept inside the project it is about: one Markdown
 * file per deck at `<project>/.kehikot/slides/<slug>.md`, and the undo trail
 * of agent writes at `<project>/.kehikot/slides/history.json`.
 *
 * There is no default project: with no project every read is empty and every
 * write is refused, because a guessed folder is one where work is written and
 * never seen again. Both sides are realpath'd before the containment check, so
 * a `.kehikot` (or a deck file) that is a symlink out of the project is refused
 * rather than followed.
 */

/** A refusal. `status` is the HTTP status the door answers with; a conflict carries what is there now. */
export type Failure = { ok: false; error: string; status?: number; version?: string | null; text?: string | null }
export type Result<T> = { ok: true; value: T } | Failure

export const HISTORY_FILE = 'history.json'

export const NO_PROJECT =
  'Nothing has said which project this is, so there is nowhere to keep a deck. Open a project in the host, '
  + 'or send project: the absolute directory of the project.'

/** The opaque version of a deck's text: what a client sends back as `base`. */
export function versionOf(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16)
}

/** A sentence when `slug` is not a deck name, else null. */
export function badSlug(slug: unknown): string | null {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    return `"${String(slug ?? '').slice(0, 80)}" is not a deck name: lowercase letters, digits and dashes, starting with a letter or digit.`
  }
  return null
}

function cleanTitle(title: unknown): Result<string> {
  const clean = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : ''
  if (!clean) return { ok: false, error: 'A deck needs a title.' }
  if (clean.length > 200) return { ok: false, error: 'That title is longer than 200 characters.' }
  return { ok: true, value: clean }
}

function tooLong(text: string): Failure | null {
  return text.length > MAX_DECK_CHARS
    ? { ok: false, status: 413, error: `That deck is longer than ${MAX_DECK_CHARS} characters, which is more than this module keeps.` }
    : null
}

/* ------------------------------------------------------------------ *
 * Decks
 * ------------------------------------------------------------------ */

/** Every deck in a project, most recently changed first. */
export function listDecks(project: string | null | undefined): Result<DeckSummary[]> {
  const dir = slidesDir(project, false)
  if (!dir.ok) return dir
  if (!existsSync(dir.value.dir)) return { ok: true, value: [] }
  const decks: DeckSummary[] = []
  for (const name of readdirSync(dir.value.dir)) {
    const slug = name.endsWith('.md') ? name.slice(0, -3) : ''
    if (!SLUG.test(slug)) continue
    const file = join(dir.value.dir, name)
    if (escapes(dir.value.root, file)) continue
    try {
      const stat = statSync(file)
      if (!stat.isFile()) continue
      const deck = parseDeck(readFileSync(file, 'utf8'), slug)
      decks.push({ slug, title: deck.title, epic: deck.epic, slides: deck.slides.length, updated: stat.mtimeMs })
    } catch {
      /* A file that vanished between the listing and the read is not a deck any more. */
    }
  }
  decks.sort((a, b) => b.updated - a.updated || a.slug.localeCompare(b.slug))
  return { ok: true, value: decks }
}

export function readDeck(project: string | null | undefined, slug: string): Result<DeckFile> {
  const file = deckFile(project, slug, false)
  if (!file.ok) return file
  if (!existsSync(file.value)) return missing(slug)
  const text = readFileSync(file.value, 'utf8')
  return { ok: true, value: { slug, text, version: versionOf(text) } }
}

/**
 * Replace a deck's text. With `base`, refused as a conflict (carrying what is
 * there now) unless the deck is still at that version. The deck must exist:
 * `createDeck` makes one.
 */
export function writeDeck(
  project: string | null | undefined,
  slug: string,
  text: string,
  base?: string | null,
): Result<{ version: string }> {
  if (typeof text !== 'string') return { ok: false, error: 'A deck is Markdown text, and that was not text.' }
  const long = tooLong(text)
  if (long) return long
  const file = deckFile(project, slug, true)
  if (!file.ok) return file
  const now = existsSync(file.value) ? readFileSync(file.value, 'utf8') : null
  const version = now === null ? null : versionOf(now)
  if (typeof base === 'string' && base !== version) {
    return {
      ok: false,
      status: 409,
      error:
        version === null
          ? `The deck "${slug}" was deleted while you were editing it. Nothing was written.`
          : `The deck "${slug}" changed since you opened it. Nothing was written; the deck as it is now came back with this answer.`,
      version,
      text: now,
    }
  }
  if (now === null) return missing(slug)
  put(file.value, text)
  return { ok: true, value: { version: versionOf(text) } }
}

/** A new deck with one title slide, under a slug made from the title (-2, -3… when taken). */
export function createDeck(
  project: string | null | undefined,
  title: string,
  epic?: string | null,
): Result<{ slug: string; version: string; text: string }> {
  const clean = cleanTitle(title)
  if (!clean.ok) return clean
  const wantEpic = typeof epic === 'string' && epic.trim() ? epic.trim() : null
  if (wantEpic !== null && !SLUG.test(wantEpic)) {
    return { ok: false, error: `"${wantEpic.slice(0, 80)}" is not an epic slug: lowercase letters, digits and dashes, as list_epics spells it.` }
  }
  const dir = slidesDir(project, true)
  if (!dir.ok) return dir
  const stem = slugFor(clean.value)
  let slug = stem
  for (let n = 2; existsSync(join(dir.value.dir, `${slug}.md`)); n++) slug = `${stem}-${n}`
  const text = serialiseDeck({
    title: clean.value,
    epic: wantEpic,
    aspect: '16:9',
    slides: [{ ...emptySlide(), layout: 'title', body: `# ${clean.value}` }],
  })
  put(join(dir.value.dir, `${slug}.md`), text)
  return { ok: true, value: { slug, version: versionOf(text), text } }
}

/** Change the deck's front-matter title. The slug, and so the file, stay. */
export function retitleDeck(project: string | null | undefined, slug: string, title: string): Result<{ version: string }> {
  const clean = cleanTitle(title)
  if (!clean.ok) return clean
  const read = readDeck(project, slug)
  if (!read.ok) return read
  return writeDeck(project, slug, retitle(read.value.text, clean.value))
}

/** Remove a deck's file and its undo trail. */
export function deleteDeck(project: string | null | undefined, slug: string): Result<null> {
  const removed = removeDeck(project, slug)
  if (!removed.ok) return removed
  const trail = loadHistory(project)
  if (trail.ok && trail.value.entries.some((one) => one.slug === slug)) {
    saveHistory(trail.value.file, trail.value.entries.filter((one) => one.slug !== slug))
  }
  return { ok: true, value: null }
}

function removeDeck(project: string | null | undefined, slug: string): Result<null> {
  const file = deckFile(project, slug, false)
  if (!file.ok) return file
  if (!existsSync(file.value)) return missing(slug)
  rmSync(file.value)
  return { ok: true, value: null }
}

/* ------------------------------------------------------------------ *
 * Citations
 * ------------------------------------------------------------------ */

/** The largest file a citation is looked for in. A paper's chapter is far smaller. */
const MAX_CITED_BYTES = 5_000_000

/**
 * A project file's text, for finding a quote in, or null when it is not read.
 * The path is a deck's, and a deck can arrive with a cloned project, so it is a
 * stranger's string. Refused, all alike:
 *
 * - an absolute path, `..`, and any dot-file or dot-folder on the way, as
 *   written AND as resolved, except a paper's own (`.kehikot/paper/…`), which
 *   is what a slide cites;
 * - anything resolving outside the project, through a link at any segment;
 * - what is missing, not a file, or over {@link MAX_CITED_BYTES}.
 */
export function citedText(root: string, path: string): string | null {
  if (!path || path.length > 1000 || path.includes('\0') || isAbsolute(path)) return null
  const written = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (hidden(written.split('/'))) return null
  try {
    /* Every segment resolved, so a folder that is a link is judged by where it leads. */
    const real = realpathSync(join(root, written))
    if (!within(root, real) || real === root || hidden(relative(root, real).split('/'))) return null
    const stat = statSync(real)
    if (!stat.isFile() || stat.size > MAX_CITED_BYTES) return null
    return readFileSync(real, 'utf8')
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/** The largest picture a slide is served. A figure is far smaller. */
export const MAX_PICTURE_BYTES = 10_000_000

const starts = (bytes: Uint8Array, at: number, ...want: number[]) => want.every((byte, i) => bytes[at + i] === byte)
const ascii = (text: string) => [...text].map((one) => one.charCodeAt(0))

/**
 * What a slide may show from the project: by extension, the type it is sent
 * as, and what its first bytes must be. Both have to agree, so a file renamed
 * to `.png` is not served as one. `pdf` is here because a paper's figures are
 * PDFs; only WebKit (the desktop app) draws one in an `<img>`.
 */
const PICTURES: Record<string, { type: string; looks: (bytes: Uint8Array) => boolean }> = {
  png: { type: 'image/png', looks: (b) => starts(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) },
  jpg: { type: 'image/jpeg', looks: (b) => starts(b, 0, 0xff, 0xd8, 0xff) },
  jpeg: { type: 'image/jpeg', looks: (b) => starts(b, 0, 0xff, 0xd8, 0xff) },
  gif: { type: 'image/gif', looks: (b) => starts(b, 0, ...ascii('GIF87a')) || starts(b, 0, ...ascii('GIF89a')) },
  webp: { type: 'image/webp', looks: (b) => starts(b, 0, ...ascii('RIFF')) && starts(b, 8, ...ascii('WEBP')) },
  pdf: { type: 'application/pdf', looks: (b) => starts(b, 0, ...ascii('%PDF-')) },
  /* Markup, so no magic number: it has to open as XML and have an <svg> element near the top. */
  svg: {
    type: 'image/svg+xml',
    looks: (b) => {
      const head = Buffer.from(b.subarray(0, 2048)).toString('utf8').replace(/^﻿/, '').trimStart()
      return head.startsWith('<') && /<svg[\s>]/i.test(head)
    },
  },
}

/** Where a paper and its figures are kept: the one dot-folder a slide's picture or citation is read from. */
const PAPER_FIGURES = ['.kehikot', 'paper']

/** Does this path go through a dot-file or dot-folder (`.git`, `.env`, `..`) other than a paper's own? */
function hidden(segments: string[]): boolean {
  const rest = PAPER_FIGURES.every((name, i) => segments[i] === name) ? segments.slice(PAPER_FIGURES.length) : segments
  return rest.some((one) => one.startsWith('.'))
}

/**
 * A picture in the project that a slide names, or null when it is not served.
 * The path is a deck's, and a deck can arrive with a cloned project, so it is a
 * stranger's string. Refused, all alike:
 *
 * - a project that is not one with a slides folder: decks are the only thing
 *   that names a picture, so no other directory is read through this door;
 * - an absolute path, `..`, and any dot-file or dot-folder on the way, as
 *   written AND as resolved, except a paper's own (`.kehikot/paper/…`), where
 *   its figures are;
 * - anything resolving outside the project, through a link at any segment;
 * - what is not a picture by its extension, or whose bytes are not that type;
 * - what is missing, not a file, empty, or over {@link MAX_PICTURE_BYTES}.
 */
export function pictureBytes(project: string | null | undefined, path: string): { bytes: Uint8Array; type: string } | null {
  const slides = slidesDir(project, false)
  if (!slides.ok || !existsSync(slides.value.dir)) return null
  const root = slides.value.root
  const kind = PICTURES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '']
  if (!kind || path.length > 1000 || path.includes('\0') || isAbsolute(path)) return null
  const written = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (hidden(written.split('/'))) return null
  try {
    /* Every segment resolved, so a folder that is a link out of the project is refused like a file that is one. */
    const real = realpathSync(join(root, written))
    if (!within(root, real) || real === root || hidden(relative(root, real).split('/'))) return null
    const stat = statSync(real)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PICTURE_BYTES) return null
    const bytes = readFileSync(real)
    return kind.looks(bytes) ? { bytes, type: kind.type } : null
  } catch {
    return null
  }
}

/** The largest passage a selection can be cited from, in bytes. */
export const MAX_CITED_SLICE = 4000

/**
 * The exact words between two byte offsets of a project file: what a reader
 * selected in the paper, as the source has it rather than as it was drawn.
 *
 * Only for a project that has a slides folder: a deck is the only thing a
 * passage is cited into, so no other directory is read through this door. The
 * file itself is confined as {@link citedText} says.
 */
export function citedSlice(project: string | null | undefined, path: string, from: number, to: number): Result<string> {
  const slides = slidesDir(project, false)
  if (!slides.ok) return slides
  if (!existsSync(slides.value.dir)) return { ok: false, status: 404, error: 'This project has no decks, so there is nothing to cite into.' }
  const root = slides.value.root
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) return { ok: false, error: 'from and to are byte offsets, to after from.' }
  if (to - from > MAX_CITED_SLICE) return { ok: false, error: `That selection is longer than ${MAX_CITED_SLICE} bytes; cite a sentence or two.` }
  const text = citedText(root, path)
  if (text === null) return { ok: false, status: 404, error: `"${path.slice(0, 200)}" is not a readable file inside this project.` }
  const all = Buffer.from(text, 'utf8')
  if (to > all.length) return { ok: false, error: 'That range runs past the end of the file; the paper may have changed since it was selected.' }
  return { ok: true, value: all.subarray(from, to).toString('utf8') }
}

/** Every slide's sources, each looked for in its file. Indexed like the slides. */
export function citations(project: string | null | undefined, slug: string): Result<CitationView[][]> {
  const root = projectRoot(project)
  if (!root.ok) return root
  const deck = readDeck(root.value, slug)
  if (!deck.ok) return deck
  const files = new Map<string, string | null>()
  const textOf = (path: string) => {
    if (!files.has(path)) files.set(path, citedText(root.value, path))
    return files.get(path) ?? null
  }
  return { ok: true, value: parseDeck(deck.value.text, slug).slides.map((slide) => slide.sources.map((one) => resolveSource(one, textOf(one.path)))) }
}

/* ------------------------------------------------------------------ *
 * The undo trail
 * ------------------------------------------------------------------ */

/** One entry as kept: `before` is the deck's text before the write, null when the write created it. */
export interface Kept extends HistoryEntry {
  before: string | null
}

export interface Recorded {
  agent: string
  summary: string
}

/**
 * Write a deck and remember what it was, so a person can undo it. Every write
 * an agent makes goes through here. `text` null removes the deck; a deck that
 * does not exist yet is created.
 */
export function recordedWrite(
  project: string | null | undefined,
  slug: string,
  text: string | null,
  by: Recorded,
): Result<{ version: string | null; id: string }> {
  if (text !== null) {
    const long = tooLong(text)
    if (long) return long
  }
  const file = deckFile(project, slug, text !== null)
  if (!file.ok) return file
  const previous = existsSync(file.value) ? readFileSync(file.value, 'utf8') : null
  if (text === null) {
    if (previous !== null) rmSync(file.value)
  } else {
    put(file.value, text)
  }
  const id = record(project, slug, previous, by)
  return { ok: true, value: { version: text === null ? null : versionOf(text), id } }
}

/**
 * Remember an entry for a write that has happened (`createDeck` made the file;
 * this says an agent did, and that undoing it removes the deck). Keeps the
 * last {@link HISTORY_PER_DECK} entries of each deck.
 */
export function record(project: string | null | undefined, slug: string, before: string | null, by: Recorded): string {
  const id = crypto.randomUUID().slice(0, 8)
  const trail = loadHistory(project, true)
  if (!trail.ok) return id
  const entry: Kept = {
    id,
    slug,
    at: new Date().toISOString(),
    agent: String(by.agent ?? '').trim().slice(0, 80) || 'an agent',
    summary: String(by.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'an edit',
    before,
  }
  const entries = [...trail.value.entries, entry]
  const mine = entries.filter((one) => one.slug === slug)
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - HISTORY_PER_DECK)).map((one) => one.id))
  saveHistory(trail.value.file, entries.filter((one) => !drop.has(one.id)))
  return id
}

/** A deck's undo trail, newest first, without the previous texts. */
export function history(project: string | null | undefined, slug: string): Result<HistoryEntry[]> {
  const bad = badSlug(slug)
  if (bad) return { ok: false, error: bad }
  const trail = loadHistory(project)
  if (!trail.ok) return trail
  return {
    ok: true,
    value: trail.value.entries
      .filter((one) => one.slug === slug)
      .reverse()
      .map(({ id, slug: s, at, agent, summary }) => ({ id, slug: s, at, agent, summary })),
  }
}

/**
 * Put a deck back to how it was before entry `id`. The undo is itself an
 * entry (by 'person'), so it can be undone in turn. Undoing a creation removes
 * the deck.
 */
export function undo(project: string | null | undefined, slug: string, id: string): Result<{ version: string | null }> {
  const bad = badSlug(slug)
  if (bad) return { ok: false, error: bad }
  const trail = loadHistory(project)
  if (!trail.ok) return trail
  const entry = trail.value.entries.find((one) => one.id === id && one.slug === slug)
  if (!entry) return { ok: false, status: 404, error: `There is no entry "${String(id).slice(0, 40)}" in the history of "${slug}".` }
  const written = recordedWrite(project, slug, entry.before, { agent: 'person', summary: `undo: ${entry.summary}` })
  return written.ok ? { ok: true, value: { version: written.value.version } } : written
}

function loadHistory(project: string | null | undefined, make = false): Result<{ file: string; entries: Kept[] }> {
  const dir = slidesDir(project, make)
  if (!dir.ok) return dir
  const file = join(dir.value.dir, HISTORY_FILE)
  if (!existsSync(file)) return { ok: true, value: { file, entries: [] } }
  const escaped = escapes(dir.value.root, file)
  if (escaped) return { ok: false, error: escaped }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }
    const entries = Array.isArray(parsed.entries) ? (parsed.entries as Kept[]) : []
    return { ok: true, value: { file, entries } }
  } catch {
    return { ok: false, error: `${file} is not readable JSON. Nothing was changed; fix or remove the file.` }
  }
}

function saveHistory(file: string, entries: Kept[]): void {
  put(file, `${JSON.stringify({ entries }, null, 1)}\n`)
}

/* ------------------------------------------------------------------ *
 * Where things are, checked
 * ------------------------------------------------------------------ */

const missing = (slug: string): Failure => ({ ok: false, status: 404, error: `There is no deck "${slug}" in this project.` })

/** Written to a temporary file and renamed, so a crash never leaves half a file. */
function put(file: string, text: string): void {
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, file)
}

/** A deck's file, checked; `make` creates the slides folder first. */
function deckFile(project: string | null | undefined, slug: string, make: boolean): Result<string> {
  const bad = badSlug(slug)
  if (bad) return { ok: false, error: bad }
  const dir = slidesDir(project, make)
  if (!dir.ok) return dir
  const file = join(dir.value.dir, `${slug}.md`)
  if (existsSync(file)) {
    const escaped = escapes(dir.value.root, file)
    if (escaped) return { ok: false, error: escaped }
  }
  return { ok: true, value: file }
}

/** The project's slides folder, checked to resolve inside the project. `make` creates it first. */
export function slidesDir(project: string | null | undefined, make: boolean): Result<{ root: string; dir: string }> {
  const root = projectRoot(project)
  if (!root.ok) return root

  const dir = moduleDir(root.value, ID)!
  const levels = [kehikotDir(root.value)!, dir]
  /* Checked before making anything, so a folder that escapes is never written
     into, and again after, for what mkdir just made. */
  const escaped = escapesAny(root.value, levels)
  if (escaped) return { ok: false, error: escaped }
  if (make) {
    mkdirSync(dir, { recursive: true })
    const after = escapesAny(root.value, levels)
    if (after) return { ok: false, error: after }
  }
  return { ok: true, value: { root: root.value, dir } }
}

/**
 * What state that outlives a request is keyed by for this project: its id (`.kehikot/project.json`, which
 * the host writes) when it has one, else its path (`projectKey`). A map from path to state goes stale
 * the moment the folder is renamed; the id does not.
 */
export function keyOf(root: string): string {
  let id: string | null = null
  try {
    const file = projectFile(root)
    id = file === null ? null : (readProjectFile(JSON.parse(readFileSync(file, 'utf8')))?.id ?? null)
  } catch {
    id = null
  }
  return projectKey({ projectId: id, projectPath: root })?.key ?? root
}

/** The project folder, realpath'd, or a sentence saying why there is none. */
export function projectRoot(project: string | null | undefined): Result<string> {
  const raw = typeof project === 'string' ? project.trim() : ''
  if (!raw) return { ok: false, error: NO_PROJECT }
  if (!isAbsolute(raw)) return { ok: false, error: `"${raw.slice(0, 200)}" is not an absolute path.` }
  try {
    const real = realpathSync(raw)
    if (!statSync(real).isDirectory()) return { ok: false, error: `"${raw.slice(0, 200)}" is not a folder.` }
    return { ok: true, value: real }
  } catch {
    return { ok: false, error: `There is no folder at "${raw.slice(0, 200)}" on this machine.` }
  }
}

function escapesAny(root: string, paths: string[]): string | null {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const escaped = escapes(root, path)
    if (escaped) return escaped
  }
  return null
}

function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so nothing is read or written through it.`
  }
  return within(root, real) ? null : `${child} resolves to ${real}, outside the project. Refused rather than followed.`
}
