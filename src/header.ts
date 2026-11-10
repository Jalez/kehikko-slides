import { LIMITS, type HeaderItemInput } from 'kehikot-module-protocol'

/**
 * What this page declares for the container's header (`kehikot.header`).
 *
 * The host draws these as View, Go and Run in the row a container already has, so the page has no
 * strip of its own: the deck switcher, Edit / Preview, following, Present, Presenter view, Export
 * PDF and History are here and none is drawn in the page. Where the page is in the deck is the
 * footer's when the host draws one (`footer.ts`): the header is how the module is set up, the
 * footer what is going on now.
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
  /** Where the slide in front is, in words (`positionSaid`): `3 / 25`, or its place among the shown. */
  position: string
  /** The shown slide before and after the one in front, or null at either end. */
  before: number | null
  after: number | null
}

export interface HeaderState {
  decks: { slug: string; title: string }[]
  open: string | null
  /** Null while no deck is open, or its text has not arrived. */
  work: Work | null
  /** The host draws this header and goes full screen for a run that asks (`drawsHeader === true`): Present says so. */
  surface?: boolean
  /**
   * The host draws this page's footer (`drawsFooter === true`): where the page is in the deck — the
   * slide x of y and the slides to go to — and which deck is on show are the footer's (`footer.ts`),
   * so the header names neither. With any other host they stay here, as before.
   */
  footed?: boolean
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
    const options = decks.map((one, i) => ({ id: `d${i}`, label: cut(one.title) }))
    const at = decks.findIndex((one) => one.slug === state.open)
    /* Which deck is open is held state, so with one open the picker is a switch resting on it. With none open
       there is nothing held, and the picker is a jump. */
    items.push(
      at >= 0
        ? { kind: 'switch', id: 'deck', label: 'Decks', icon: 'presentation', value: `d${at}`, options }
        : { kind: 'go', id: 'deck', label: 'Decks', icon: 'presentation', options },
    )
  }
  if (work && work.slides.length && !state.footed) {
    items.push({
      kind: 'go',
      id: 'slide',
      /* Where the slide is, is the footer's; with a host that draws none the page says it in its own row. */
      label: 'Go to slide',
      icon: 'layout-list',
      /* An agent turns the page with the door's own tool, and is sent there. */
      tool: 'show_slide',
      options: slidesOffered(work.slides, work.current).map((one) => ({ id: `s${one.index}`, label: cut(`${one.index + 1}. ${one.headline || '(empty)'}`) })),
    })
  }

  if (work) {
    /* The host makes the frame full screen from its own click, which a relayed press could not (a host that says nothing is not told). */
    items.push({ kind: 'run', id: 'present', label: 'Present', icon: 'play', disabled: talking, ...(state.surface ? { surface: 'fullscreen' as const } : {}) })
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
