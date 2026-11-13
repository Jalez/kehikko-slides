import type { DeckSummary } from '../../deck/api.ts'

/**
 * The deck each place shows.
 *
 * A place is the space the person stands in (`context.space`, protocol 2.89.0): its path of ids from
 * the top-level space and the children picked out together. A host from before spaces says only an
 * epic and its picked parts, which is the same place by the same mapping the protocol uses: the epic
 * is the top-level space, one picked part is that child, several are the epic with those picked. So
 * both spell the same key for every place an older host can name.
 *
 * A place keeps ITS OWN deck and nothing it did not keep: arriving at a place that has none shows
 * that it has none, never the deck of the place before it.
 */
export interface Place {
  epic: string | null
  /** The ids of the parts picked out. Empty is the whole epic. */
  parts: readonly string[]
  /** `context.space`, from a host that says spaces; it wins over `epic` and `parts`, which such a host fills from it. */
  space?: { path: readonly { id: string }[]; picked?: readonly string[] } | null
}

const sorted = (ids: readonly string[]) => [...new Set(ids)].sort()

/** The place as a path of space ids and the children picked out: the one spelling both kinds of host reduce to. */
export function spaceOf(place: Place): { ids: string[]; picked: string[] } {
  const said = place.space?.path.map((step) => step.id) ?? []
  if (said.length) return { ids: said, picked: sorted(place.space?.picked ?? []) }
  if (!place.epic) return { ids: [], picked: [] }
  const parts = sorted(place.parts)
  return parts.length === 1 ? { ids: [place.epic, parts[0]!], picked: [] } : { ids: [place.epic], picked: parts }
}

/** The key a place's deck is kept under. The project's own place, with no space, is `project`. */
export function placeKey(place: Place): string {
  const { ids, picked } = spaceOf(place)
  if (!ids.length) return 'project'
  return picked.length ? `${ids.join('.')}|${picked.join(',')}` : ids.join('.')
}

/**
 * The epic a place's decks are tagged with (a deck's `epic` is the top-level space), and whether the
 * place shares that epic's decks. A top-level space and its direct children, the parts, do: a part is
 * a way of narrowing the epic's deck to its slides, not a place with a deck of its own. A space nested
 * deeper has only what was opened or made there.
 */
export function homeOf(place: Place): { epic: string | null; shares: boolean } {
  const { ids } = spaceOf(place)
  return { epic: ids[0] ?? null, shares: ids.length <= 2 }
}

/** What is kept: the slug of the deck each place last had open. */
export type Kept = Record<string, string>

/** Whether a kept value is of that shape; anything else is as if nothing were kept. */
export function isKept(value: unknown): value is Kept {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((one) => typeof one === 'string')
}

const byTitle = (a: DeckSummary, b: DeckSummary) => a.title.localeCompare(b.title)

/**
 * The deck to show at a place, or null: the empty place. The one this place kept, while it still
 * exists; else, where the place shares its epic's decks, the first of them; else none.
 */
export function deckAt(list: readonly DeckSummary[], place: Place, kept: Kept): string | null {
  const own = kept[placeKey(place)]
  if (own && list.some((one) => one.slug === own)) return own
  const home = homeOf(place)
  if (!home.shares) return null
  return [...list].filter((one) => (one.epic ?? null) === home.epic).sort(byTitle)[0]?.slug ?? null
}
