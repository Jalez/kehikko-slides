import { emptySaid, partsOfFile, type Anchor } from 'kehikot-module-protocol'
import type { Focus } from 'kehikot-module-protocol/client/react'

import type { Slide } from '../deck/format.ts'
import { anchorOf } from './follow.ts'

/**
 * A deck under the parts picked in the host's bar: which slides are shown.
 *
 * ## One rule, and it is not this file's
 *
 * A part belongs to the epic and names no module; what it has is a list of
 * documents, which the host unions from what every module published for it
 * (a host from before that sends the paper-relative `files`). Whether a slide
 * is in a picked part is asked of the protocol and never answered here: every
 * slide says what ties it to a part with `anchorOf` (`follow.ts`), and
 * `useFocus(host).narrow` decides.
 *
 * ## It narrows, as the paper does
 *
 * The strip, the slide on screen, stepping, the counter and presenting hold
 * only the slides of the picked parts. Nothing picked is the whole deck,
 * exactly as it was.
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
 * A slide is in a picked part when the file of the section it is linked to,
 * or of any passage it cites, is one that part has. The title slide and the
 * closing one, when nothing ties them to a part, are part of every part and
 * are shown under any pick. Any other slide tied to no part is outside every
 * pick, like a step filed under none.
 *
 * ## The slide in hand
 *
 * A slide outside the pick that the person is IN — the caret was put in it in
 * the Markdown, or it has unsaved typing — is kept (`held`, the rule's
 * `keep`): drawn, in its place in the order, set back in the strip. It leaves
 * when they leave it.
 *
 * ## And nothing is said
 *
 * No line, no count of what is outside, no label on a slide: the host's bar
 * says what is picked and the narrowed deck is the message. The one exception
 * is `empty` — the protocol's `No slide is in the picked part.` — drawn
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
  /**
   * Of `shown`, the slides that are in the pick by their own source: not the
   * title or closing slide that is part of every part, and not the one held.
   * Where the deck goes when a pick leaves the slide on screen out: to the
   * part's own slides, as it did before the title slide was shown with them.
   */
  sourced: number[]
  /** The protocol's sentence for a preview the pick left with no slide. `''` when nothing is picked. */
  empty: string
}

/** What one item is called in the protocol's sentence for an empty preview. */
export const NOUN = 'slide'

/**
 * Each slide's anchors, by its index: `anchorOf` with what it is read against
 * — the project, the slide's place in the deck, and whether a part of the
 * epic has a file (asked of the protocol, `partsOfFile`).
 */
export function anchorsIn(focus: Focus, slides: readonly Slide[], project: string, epic: string | null): (index: number) => Anchor[] {
  const tied = (file: string) => partsOfFile(focus.parts, file, epic, project).length > 0
  return (index) => {
    const slide = slides[index]
    return slide ? anchorOf(slide, { project, index, count: slides.length, tied }) : []
  }
}

export function narrowDeck(
  focus: Focus,
  slides: readonly Slide[],
  project: string,
  epic: string | null,
  held: number | null,
): Narrowing {
  const all = slides.map((_, index) => index)
  const anchors = anchorsIn(focus, slides, project, epic)
  const narrowed = focus.narrow(all, anchors, { noun: NOUN, keep: (index) => index === held })
  const kept = focus.focused && narrowed.kept > 0 ? held : null
  return {
    focused: focus.focused,
    shown: narrowed.shown,
    held: kept,
    sourced: narrowed.shown.filter((index) => index !== kept && !anchors(index).some((anchor) => 'whole' in anchor)),
    empty: emptySaid(focus.parts, NOUN),
  }
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
