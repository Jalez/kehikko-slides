import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

import { SLUG, type DeckChange, type PresentState } from './deck/api.ts'
import { slidesDir, versionOf, type Result } from './store.ts'

/**
 * What is pushed to pages: a deck file changed (by any path — this module's
 * API, an agent over MCP, or a person editing the file on disk), and where a
 * talk is. Plain listeners; `vite.config.ts` turns them into server-sent events.
 */

type Listener<T> = (event: T) => void

/* ------------------------------------------------------------------ *
 * Deck changes
 * ------------------------------------------------------------------ */

/** How long a burst of file events is gathered before the decks are looked at. */
export const SETTLE_MS = 100

/** How often a project with no slides folder yet is checked for one. */
const LOOK_FOR_FOLDER_MS = 2000

interface Group {
  dir: string
  listeners: Set<Listener<DeckChange>>
  /** Last version seen of each deck, so an event is sent only for a real change. */
  known: Map<string, string>
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  poll: ReturnType<typeof setInterval> | null
}

const groups = new Map<string, Group>()

function versions(dir: string): Map<string, string> {
  const found = new Map<string, string>()
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    const slug = name.endsWith('.md') ? name.slice(0, -3) : ''
    if (!SLUG.test(slug)) continue
    try {
      found.set(slug, versionOf(readFileSync(join(dir, name), 'utf8')))
    } catch {
      /* Gone between the listing and the read: it is reported as gone next time. */
    }
  }
  return found
}

/** Look at the decks now and tell every listener about each one that changed since last time. */
function rescan(group: Group): void {
  group.timer = null
  const now = versions(group.dir)
  const changes: DeckChange[] = []
  for (const [slug, version] of now) if (group.known.get(slug) !== version) changes.push({ slug, version })
  for (const slug of group.known.keys()) if (!now.has(slug)) changes.push({ slug, version: null })
  group.known = now
  for (const change of changes) for (const listener of group.listeners) listener(change)
}

function attach(group: Group): void {
  if (group.watcher || !existsSync(group.dir)) return
  try {
    group.watcher = watch(group.dir, () => settle(group))
    group.watcher.on('error', () => {
      group.watcher?.close()
      group.watcher = null
    })
    if (group.poll) clearInterval(group.poll)
    group.poll = null
    /* Anything written between the first look and the watcher starting. */
    settle(group)
  } catch {
    group.watcher = null
  }
}

function settle(group: Group): void {
  if (group.timer) clearTimeout(group.timer)
  group.timer = setTimeout(() => rescan(group), SETTLE_MS)
}

/**
 * Be told `{slug, version}` whenever a deck in this project changes. The
 * folder is watched while anybody is listening, and let go of when the last
 * listener leaves. A project with no slides folder yet is checked for one
 * every couple of seconds rather than having one made by a read.
 */
export function watchDecks(project: string, listener: Listener<DeckChange>): Result<() => void> {
  const dir = slidesDir(project, false)
  if (!dir.ok) return dir
  let group = groups.get(dir.value.dir)
  if (!group) {
    group = {
      dir: dir.value.dir,
      listeners: new Set(),
      known: versions(dir.value.dir),
      watcher: null,
      timer: null,
      poll: null,
    }
    groups.set(dir.value.dir, group)
    attach(group)
    if (!group.watcher) {
      const waiting = group
      waiting.poll = setInterval(() => attach(waiting), LOOK_FOR_FOLDER_MS)
    }
  }
  const mine = group
  mine.listeners.add(listener)
  return {
    ok: true,
    value: () => {
      mine.listeners.delete(listener)
      if (mine.listeners.size) return
      mine.watcher?.close()
      if (mine.timer) clearTimeout(mine.timer)
      if (mine.poll) clearInterval(mine.poll)
      groups.delete(mine.dir)
    },
  }
}

/**
 * Say a deck in this project may have changed. The doors call it after their
 * own writes, so a page hears about them even where file events are slow or
 * missing; a change the watcher also saw is still sent once.
 */
export function poke(project: string): void {
  const dir = slidesDir(project, false)
  if (!dir.ok) return
  const group = groups.get(dir.value.dir)
  if (!group) return
  attach(group)
  settle(group)
}

/** How many projects are being watched; for tests. */
export function watching(): number {
  return groups.size
}

/* ------------------------------------------------------------------ *
 * Presenting
 * ------------------------------------------------------------------ */

const talks = new Map<string, { state: PresentState; listeners: Set<Listener<PresentState>> }>()

function talk(root: string, slug: string) {
  const key = `${root}\0${slug}`
  let one = talks.get(key)
  if (!one) {
    one = { state: { slug, index: 0, blank: false, at: 0 }, listeners: new Set() }
    talks.set(key, one)
  }
  return { key, one }
}

/**
 * Listen to where a talk is. The current state is sent at once, then every
 * move. In memory only: a talk does not outlive the server.
 */
export function followTalk(root: string, slug: string, listener: Listener<PresentState>): () => void {
  const { key, one } = talk(root, slug)
  one.listeners.add(listener)
  listener(one.state)
  return () => {
    one.listeners.delete(listener)
    if (!one.listeners.size && one.state.at === 0) talks.delete(key)
  }
}

/** Move a talk, and tell everybody following it. */
export function moveTalk(root: string, slug: string, index: number, blank: boolean): PresentState {
  const { one } = talk(root, slug)
  one.state = { slug, index, blank, at: Date.now() }
  for (const listener of one.listeners) listener(one.state)
  return one.state
}
