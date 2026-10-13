import { LIMITS, type HeaderItemInput } from 'kehikot-module-protocol'

/**
 * What this page declares for the container's header (`kehikot.header`).
 *
 * The host draws these as View, Go and Run in the row a container already has, so the page has no
 * strip of its own: the deck switcher, Edit / Preview, following, Present, Presenter view, Export
 * PDF and History are here and none is drawn in the page.
 *
 * A pure function of what the page knows. The page declares the list again only when its JSON
 * differs, and the slide headlines are read from the deck AS IT WAS LAST SAVED — so typing declares
 * nothing, and a headline that changed is said once, when the save lands.
 *
 * Ids: a deck is `d<n>` by its place in the list, a slide `s<n>` by its number counting from 0. A
 * press is judged against the list as it stands now, so an id only has to mean something there —
 * and a slug can be longer than an id may be.
 */

export interface Work {
  tab: 'edit' | 'preview'
  following: boolean
  /** What the following toggle says of itself while it is on: `followingLabel`. */
  followingSays: string
  /** The slides drawn, by their number in the deck, each with its headline as last saved. */
  slides: { index: number; headline: string }[]
  /** The slide in front, counting from 0, or null when the pick leaves it out. */
  current: number | null
  /** How many slides the deck has. */
  count: number
  presenting: boolean
}

export interface HeaderState {
  decks: { slug: string; title: string }[]
  open: string | null
  /** Null while no deck is open, or its text has not arrived. */
  work: Work | null
}

/** A label no longer than a label may be, cut with an ellipsis. Never empty. */
export function cut(text: string, max: number = LIMITS.HEADER_LABEL): string {
  const flat = text.replace(/\s+/g, ' ').trim() || '—'
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * At most as many slides as a go item holds: all of them, or the ones around the slide in front.
 * The window moves in whole steps of half its length, so stepping through a long deck redraws the
 * list twice per sixty-four slides and not at every slide.
 */
export function slidesOffered<T extends { index: number }>(slides: T[], current: number | null): T[] {
  const room = LIMITS.HEADER_OPTIONS
  if (slides.length <= room) return slides
  const half = room / 2
  const at = Math.max(0, slides.findIndex((one) => one.index === current))
  const from = Math.min(Math.max(0, Math.floor(at / half) * half - half / 2), slides.length - room)
  return slides.slice(from, from + room)
}

export function headerOf(state: HeaderState): HeaderItemInput[] {
  const items: HeaderItemInput[] = []
  const { work } = state
  const here = state.decks.find((one) => one.slug === state.open) ?? null
  const talking = work?.presenting ? 'A talk is being given: leave it first (Esc).' : null

  if (work) {
    items.push({
      kind: 'switch',
      id: 'mode',
      label: 'Pane',
      value: work.tab,
      options: [{ id: 'edit', label: 'Edit' }, { id: 'preview', label: 'Preview' }],
    })
    /* On, it says what following is doing — or why the slides are not moving. Person-only. */
    items.push({ kind: 'toggle', id: 'following', label: work.following ? cut(work.followingSays) : 'Follow the paper', checked: work.following })
  }

  const decks = state.decks.slice(0, LIMITS.HEADER_OPTIONS)
  if (decks.length) {
    items.push({
      kind: 'go',
      id: 'deck',
      label: here ? cut(`Decks · ${here.title}`) : 'Decks',
      icon: 'presentation',
      options: decks.map((one, i) => ({ id: `d${i}`, label: cut(one.title) })),
    })
  }
  if (work && work.slides.length) {
    items.push({
      kind: 'go',
      id: 'slide',
      label: work.current === null ? `Slides · ${work.count}` : `Slide ${work.current + 1} of ${work.count}`,
      icon: 'layout-list',
      /* An agent turns the page with the door's own tool, and is sent there. */
      tool: 'show_slide',
      options: slidesOffered(work.slides, work.current).map((one) => ({ id: `s${one.index}`, label: cut(`${one.index + 1}. ${one.headline || '(empty)'}`) })),
    })
  }

  if (work) {
    items.push({ kind: 'run', id: 'present', label: 'Present', icon: 'play', disabled: talking })
    items.push({ kind: 'run', id: 'presenter', label: 'Presenter view', icon: 'monitor-play' })
    items.push({ kind: 'run', id: 'export', label: 'Export PDF', icon: 'file-down' })
    items.push({ kind: 'run', id: 'history', label: 'History', icon: 'history', disabled: talking })
  }
  items.push({ kind: 'run', id: 'deck-new', label: 'New deck…', group: 'Decks', disabled: talking })
  if (here) {
    items.push({ kind: 'run', id: 'deck-rename', label: 'Rename this deck…', icon: 'pencil', shortcut: 'F2', group: 'Decks', disabled: talking })
    items.push({ kind: 'run', id: 'deck-remove', label: cut(`Remove “${cut(here.title, 28)}”`), icon: 'trash-2', group: 'Decks', confirm: true, disabled: talking })
  }
  return items
}
