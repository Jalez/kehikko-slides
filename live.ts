import { existsSync, readdirSync, readFileSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

import { within } from 'kehikot-module-protocol'
import { events, publish, watching as following } from 'kehikot-module-protocol/serve'

import { SLUG, type DeckChange, type PointerState, type PresentState } from './deck/api.ts'
import { keyOf, slidesDir, versionOf, type Result } from './store.ts'

/**
 * What is pushed to pages: a deck file changed (by any path — this module's
 * API, an agent over MCP, or a person editing the file on disk), where a
 * talk is, and which slide a deck was pointed at. Plain listeners; `vite.config.ts` turns them into server-sent events.
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
  /** The project's key (`keyOf`) the group is kept under, and the folder and slides folder it is looking at now. */
  key: string
  root: string
  dir: string
  listeners: Set<Listener<DeckChange>>
  /** Last version seen of each deck, so an event is sent only for a real change. */
  known: Map<string, string>
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  poll: ReturnType<typeof setInterval> | null
}

/* By the project's key, not the folder: a folder that is renamed under a watch is the same group,
   pointed at where it is now (`lookAt`) the next time anything says where that is. */
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
  /* A project folder that is gone — renamed, or moved, and not yet said to be anywhere — has no decks
     to report gone. Nothing is said until the group is told where it is (`lookAt`). */
  if (!existsSync(group.root)) return
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

/** Keep looking for a slides folder that is not there yet. */
function lookForFolder(group: Group): void {
  if (group.watcher || group.poll) return
  group.poll = setInterval(() => attach(group), LOOK_FOR_FOLDER_MS)
}

/**
 * Say where a group's project is now. The same project in another folder is the same group: its
 * watch moves with it and what it has seen is kept, so only a real change to a deck is reported.
 */
function lookAt(group: Group, root: string, dir: string): void {
  if (group.dir === dir) return
  group.watcher?.close()
  group.watcher = null
  if (group.timer) clearTimeout(group.timer)
  group.timer = null
  group.root = root
  group.dir = dir
  attach(group)
  lookForFolder(group)
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
  const key = keyOf(dir.value.root)
  let group = groups.get(key)
  if (group) lookAt(group, dir.value.root, dir.value.dir)
  else {
    group = {
      key,
      root: dir.value.root,
      dir: dir.value.dir,
      listeners: new Set(),
      known: versions(dir.value.dir),
      watcher: null,
      timer: null,
      poll: null,
    }
    groups.set(key, group)
    attach(group)
    lookForFolder(group)
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
      if (groups.get(mine.key) === mine) groups.delete(mine.key)
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
  const group = groups.get(keyOf(dir.value.root))
  if (!group) return
  lookAt(group, dir.value.root, dir.value.dir)
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

/* A talk and a pointer are kept by the project's key and the deck, not the folder it is in: a project
   renamed under a talk is still the same talk. */
const stateKey = (root: string, slug: string): string => `${keyOf(root)}\0${slug}`

function talk(root: string, slug: string) {
  const key = stateKey(root, slug)
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

/* ------------------------------------------------------------------ *
 * Pointing
 * ------------------------------------------------------------------ */

/**
 * What one page did with a pointing, in its own words. `shown`: the slide is on its screen.
 * `outside`: on its screen though the parts picked there leave it out, as the slide in hand.
 * `stale`: not turned, because the text it holds has no such slide. `presenting`: not turned,
 * because it is giving a talk. `hidden` is whether its window was hidden when it answered.
 */
export interface PointerHeard {
  did: 'shown' | 'outside' | 'stale' | 'presenting'
  hidden: boolean
}
export const POINTER_DID = ['shown', 'outside', 'stale', 'presenting'] as const

/** How long `pointAt` waits for the pages it told to say what they did. A page answers in about a third of a second; tests shorten it. */
export const POINTER = { waitMs: 1500 }

interface Waiting {
  at: number
  need: number
  heard: PointerHeard[]
  settle(): void
}

/* Each listener, with whether its page said it is presenting. */
const pointers = new Map<string, { state: PointerState; listeners: Map<Listener<PointerState>, boolean>; waiting: Waiting | null }>()

/**
 * Listen for a deck being pointed at a slide. What is held is sent at once,
 * then every pointing. One listener is one page open on the deck, which is
 * how `pointAt` knows how many it told. A page that is `presenting` is counted
 * and not told: a talk is not turned from outside. In memory only, and
 * forgotten when the last page leaves: a pointer is a gesture, not a place the
 * deck is kept at.
 */
export function followPointer(root: string, slug: string, listener: Listener<PointerState>, presenting = false): () => void {
  const key = stateKey(root, slug)
  let one = pointers.get(key)
  if (!one) {
    one = { state: { slug, index: 0, at: 0 }, listeners: new Map(), waiting: null }
    pointers.set(key, one)
  }
  const mine = one
  mine.listeners.set(listener, presenting)
  listener(mine.state)
  return () => {
    mine.listeners.delete(listener)
    if (!mine.listeners.size && pointers.get(key) === mine) pointers.delete(key)
  }
}

/**
 * Point a deck at a slide, and say how many open pages were told (`watching`)
 * and how many were left alone because they are `presenting`. Nothing is
 * written anywhere; with no page open nothing is kept either.
 *
 * Telling a page is not the page showing it: the parts picked there may leave
 * the slide out, it may hold text without that slide, its window may be
 * hidden. So each page told says what it did (`heardPointer`), and `heard`
 * settles with those answers once every page told has given one, or after
 * `POINTER.waitMs` with the ones that came. A page that said nothing is one
 * nothing is known about, and is never counted as showing.
 */
export function pointAt(
  root: string,
  slug: string,
  index: number,
): { state: PointerState; watching: number; presenting: number; heard: Promise<PointerHeard[]> } {
  const one = pointers.get(stateKey(root, slug))
  /* Two pointings in one millisecond are still two: a page tells them apart by `at`. */
  const state = { slug, index, at: Math.max(Date.now(), (one?.state.at ?? 0) + 1) }
  if (!one) return { state, watching: 0, presenting: 0, heard: Promise.resolve([]) }
  /* A pointing still being waited on is over: the page is somewhere else now, and its answer is what came. */
  one.waiting?.settle()
  one.state = state
  let watching = 0
  for (const [listener, presenting] of one.listeners) {
    if (presenting) continue
    watching += 1
    listener(state)
  }
  const heard: PointerHeard[] = []
  const answers =
    watching === 0
      ? Promise.resolve(heard)
      : new Promise<PointerHeard[]>((resolve) => {
          const settle = () => {
            clearTimeout(timer)
            if (one.waiting?.at === state.at) one.waiting = null
            resolve(heard)
          }
          const timer = setTimeout(settle, POINTER.waitMs)
          one.waiting = { at: state.at, need: watching, heard, settle }
        })
  return { state, watching, presenting: one.listeners.size - watching, heard: answers }
}

/**
 * A page saying what it did with the pointing made at `at`. False when nobody
 * is waiting for it: the answer came too late, or was to an older pointing.
 */
export function heardPointer(root: string, slug: string, at: number, said: PointerHeard): boolean {
  const waiting = pointers.get(stateKey(root, slug))?.waiting
  if (!waiting || waiting.at !== at) return false
  waiting.heard.push(said)
  if (waiting.heard.length >= waiting.need) waiting.settle()
  return true
}

/* ------------------------------------------------------------------ *
 * Cited files
 * ------------------------------------------------------------------ */

/**
 * Telling an open deck that a file its slides cite changed, so its citation markers are looked for
 * again (protocol 2.32.0, `events`/`subscribe`): the page never asks on a clock. What travels is
 * that there IS news; the page reads `/api/citations` again, the door it already reads.
 *
 * Which files: the ones the citations door last found for that deck (`citing`, called from the
 * door). The page reads that door again after every save and every change on disk to the deck, so
 * the set follows what the deck cites. Each file's folder is watched (an editor that saves by
 * renaming leaves a watch on the file itself pointing at nothing), only while a page follows the
 * deck's topic, and closed at its next event or the next `citing` once none does.
 */

export const CITED_EVENTS_PATH = '/api/citations/events'

/** The news itself. The page reads the citations again on any event; the first is sent as a stream opens. */
export const CITED_NEWS = { changed: true } as const

export const citedTopic = (root: string, slug: string): string => `cited:${root}\n${slug}`

/* A save in an editor is several file events in one breath: one piece of news. */
const CITED_SETTLE_MS = 50
const citedSettling = new Map<string, ReturnType<typeof setTimeout>>()

/** Say that a file `topic`'s deck cites changed. Nothing is sent when no page follows it. */
function citedChanged(topic: string): void {
  if (citedSettling.has(topic) || following(topic) === 0) return
  citedSettling.set(
    topic,
    setTimeout(() => {
      citedSettling.delete(topic)
      publish(topic, CITED_NEWS)
    }, CITED_SETTLE_MS),
  )
}

/* Per topic: the folders watched, and the file names in each that are cited. */
const cited = new Map<string, Map<string, { names: Set<string>; watcher: FSWatcher }>>()

function stopCited(topic: string): void {
  for (const one of cited.get(topic)?.values() ?? []) one.watcher.close()
  cited.delete(topic)
}

/** Where a cited path really is, inside the project; null for one that is not, or cannot be found. */
function realCited(root: string, path: string): string | null {
  if (!path || path.length > 1000 || path.includes('\0') || isAbsolute(path)) return null
  try {
    const real = realpathSync(join(root, path.replace(/\\/g, '/')))
    return within(root, real) && real !== root ? real : null
  } catch {
    /* Not there (yet): its folder, if that is in the project, so the file arriving is news. */
    const folder = dirname(join(root, path))
    try {
      const real = realpathSync(folder)
      return within(root, real) ? join(real, basename(path)) : null
    } catch {
      return null
    }
  }
}

/**
 * The files `slug`'s slides cite now, as the citations door found them. Watched while a page follows
 * the deck; with none following, whatever was watched is let go.
 */
export function citing(root: string, slug: string, paths: readonly string[]): void {
  const topic = citedTopic(root, slug)
  if (following(topic) === 0) {
    stopCited(topic)
    return
  }
  const wanted = new Map<string, Set<string>>()
  for (const path of new Set(paths)) {
    const real = realCited(root, path)
    if (!real) continue
    const folder = dirname(real)
    if (!wanted.has(folder)) wanted.set(folder, new Set())
    wanted.get(folder)!.add(basename(real))
  }
  const held = cited.get(topic) ?? new Map<string, { names: Set<string>; watcher: FSWatcher }>()
  for (const [folder, one] of held) {
    if (wanted.has(folder)) continue
    one.watcher.close()
    held.delete(folder)
  }
  for (const [folder, names] of wanted) {
    const kept = held.get(folder)
    if (kept) {
      kept.names = names
      continue
    }
    try {
      const watcher = watch(folder, (_kind, name) => {
        if (following(topic) === 0) {
          stopCited(topic)
          return
        }
        const one = cited.get(topic)?.get(folder)
        if (!one) return
        if (name === null || one.names.has(String(name))) citedChanged(topic)
      })
      watcher.on('error', () => {
        watcher.close()
        cited.get(topic)?.delete(folder)
      })
      held.set(folder, { names, watcher })
    } catch {
      /* A folder that cannot be watched: the citations are still read again on every save. */
    }
  }
  if (held.size) cited.set(topic, held)
  else cited.delete(topic)
}

/** How many decks' cited files are watched; for tests. */
export const citedWatched = (): number => cited.size

/** Stop watching every cited file (tests, and a server that stops). */
export function stopCiting(): void {
  for (const topic of [...cited.keys()]) stopCited(topic)
  for (const timer of citedSettling.values()) clearTimeout(timer)
  citedSettling.clear()
}

/**
 * The stream door for `/api/citations/events?project&slug`. The topic is named from the folder as
 * given; nothing is watched until the citations door, which the host has vouched for, says which
 * files the deck cites. Its `initial` is the hint the page reads the citations on as it (re)opens.
 */
export const citedStream = events((path, query) => {
  if (path !== CITED_EVENTS_PATH) return null
  const slug = query.get('slug') ?? ''
  const project = query.get('project') ?? ''
  if (!SLUG.test(slug) || !project || !isAbsolute(project)) return null
  let root: string
  try {
    root = realpathSync(project)
  } catch {
    return null
  }
  return { topic: citedTopic(root, slug), initial: CITED_NEWS }
})
