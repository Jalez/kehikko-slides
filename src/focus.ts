import { narrowToFocus, pickedParts, type EpicPart } from 'kehikot-module-protocol'

import type { Slide } from '../deck/format.ts'
import { anchorsOf } from './follow.ts'

/**
 * A deck under the parts picked in the host's bar: which slides are shown.
 *
 * ## It narrows, as the paper does
 *
 * With a part picked this used to set the other slides back in the thumbnail
 * strip and say how many in a line above the deck. At the size a deck has on a
 * canvas the strip is not drawn at all, so the whole of it was one grey
 * sentence over a deck that looked exactly as before — beside a paper that
 * had narrowed to the part's pages. Now it does what the paper does: the
 * strip, the slide on screen, stepping, the counter and presenting hold only
 * the slides of the picked parts. Nothing picked is the whole deck, exactly
 * as it was.
 *
 * ## What is not narrowed
 *
 * The Markdown. The deck is one file and the editor shows all of it, in its
 * order; nothing here is ever written into it. The print view and the
 * presenter's window are whole too: they are pages of their own with no host
 * and no parts, and an export that silently lacked slides would be a trap.
 * The MCP door reads and numbers the whole deck. A slide keeps its number in
 * the deck — slide 9 is slide 9 with eight others not drawn.
 *
 * ## Which slides are in a part
 *
 * The protocol's rule over `anchorsOf` (`follow.ts`): a slide is in a picked
 * part when the file of the section it is linked to, or of any passage it
 * cites, is one that part owns. A slide with neither — a title slide, a
 * closing one — belongs to the deck as a whole and to no part, so it is
 * outside every pick, like a step filed under none.
 *
 * ## The slide in hand
 *
 * A slide outside the pick that the person is IN — the caret was put in it in
 * the Markdown, or it has unsaved typing — is kept (`held`): drawn, in its
 * place in the order, set back in the strip. It leaves when they leave it.
 *
 * ## And nothing is said
 *
 * No line, no count of what is outside: the host's bar says what is picked
 * and the narrowed deck is the message. The one exception is `EMPTY`, drawn
 * inside the preview when the pick leaves no slide at all, because an empty
 * pane with no words in it looks broken.
 */
export interface Narrowing {
  /** Whether a part is picked. False is the whole deck. */
  focused: boolean
  /** The slides shown, as indices into the deck, ascending. Every index when nothing is picked. */
  shown: number[]
  /** The slide shown although it is outside the pick, because the person is in it. Null when there is none. */
  held: number | null
}

export function narrowDeck(
  parts: readonly EpicPart[],
  slides: readonly Slide[],
  project: string,
  epic: string | null,
  held: number | null,
): Narrowing {
  const all = slides.map((_, index) => index)
  const narrowed = narrowToFocus(parts, all, (index) => anchorsOf(slides[index]!, project), { epic, keep: (index) => index === held })
  const focused = pickedParts(parts).length > 0
  return { focused, shown: narrowed.shown, held: focused && narrowed.kept > 0 ? held : null }
}

/** The shown slide nearest a slide of the deck: the next one on, or failing that the last one before. Null when none is shown. */
export function nearestShown(shown: readonly number[], index: number): number | null {
  if (shown.length === 0) return null
  let best = shown[0]!
  for (const one of shown) {
    if (Math.abs(one - index) < Math.abs(best - index) || (Math.abs(one - index) === Math.abs(best - index) && one > best)) best = one
  }
  return best
}

/** The shown slide one step from `index`, which need not itself be shown. Null at either end. */
export function stepShown(shown: readonly number[], index: number, by: 1 | -1): number | null {
  if (by > 0) return shown.find((one) => one > index) ?? null
  for (let i = shown.length - 1; i >= 0; i--) if (shown[i]! < index) return shown[i]!
  return null
}

/**
 * Where the slide on screen is: `3 / 25` with the whole deck, and under a
 * pick its place among the shown slides beside its own number in the deck —
 * `2 of 5 · slide 9 of 25` — since at the width a deck usually has there is
 * no strip to read the number off.
 */
export function positionSaid(narrowing: Narrowing, front: number | null, total: number): string {
  if (!narrowing.focused) return `${(front ?? 0) + 1} / ${total}`
  if (front === null) return `0 of ${narrowing.shown.length} · ${total} in the deck`
  return `${narrowing.shown.indexOf(front) + 1} of ${narrowing.shown.length} · slide ${front + 1} of ${total}`
}

/** The one sentence, drawn inside the preview when the pick leaves no slide to draw. */
export function emptySaid(parts: readonly EpicPart[]): string {
  return `No slide of this deck is linked to or cites a file of the picked part${pickedParts(parts).length === 1 ? '' : 's'}.`
}
