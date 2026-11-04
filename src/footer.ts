import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'

import { cut, slidesOffered, type Work } from './header.ts'
import type { SaveState } from './use-deck.ts'

/**
 * What this page declares for the container's footer (`kehikot.footer`, protocol 2.38.0): what is
 * going on now. Where you are in the deck — the slide x of y, with Previous and Next and the slides
 * to go to beside it — whether the deck is saved, which deck is on show, and what went wrong.
 *
 * The rule the two rows follow: the header is how the module is set up (which pane, following,
 * which deck, Present, Presenter view, Export PDF, History, the deck's own acts), the footer is
 * what is going on now. Folded to two rows, a container shows its header and this footer, so the
 * slide number and the save word are what a person reads there.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its own row under the preview and its own save word exactly as before, and the
 * slides to go to stay in the header. Pure, so what is declared is what is tested.
 */

/** The ids of what can be pressed in the footer. */
export const FOOT = { PREVIOUS: 'previous', NEXT: 'next', SLIDE: 'slide' } as const

export interface FooterState {
  /** The open deck's slides and where the page is among them; null while no deck is open or read. */
  work: Work | null
  /** The open deck's title, or null. */
  deck: string | null
  /** Whether the open deck is saved; null while none is open. */
  save: SaveState | null
  /** The last thing that went wrong with the decks, said in words, or null. */
  trouble: string | null
}

const WORDS: Record<SaveState, string> = {
  loading: 'opening…',
  saved: 'saved',
  unsaved: 'editing',
  saving: 'saving…',
  conflict: 'not saved',
  failed: 'not saved',
}

const SAID: Record<SaveState, string> = {
  loading: 'The deck is being opened.',
  saved: 'Everything typed is saved.',
  unsaved: 'What was typed is saved in a moment.',
  saving: 'What was typed is being saved.',
  conflict: 'Not saved: the deck was changed elsewhere first. Reload theirs or keep yours.',
  failed: 'Not saved: the last save failed.',
}

/** One line cut to fit with an ellipsis. */
export function clip(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`
}

/** The footer's items for a state; `[]` when there is nothing to show. */
export function footerItems(state: FooterState): FooterItemInput[] {
  const items: FooterItemInput[] = []
  const { work } = state
  if (state.trouble) {
    items.push({ kind: 'text', id: 'trouble', text: clip(state.trouble, LIMITS.FOOTER_TEXT), level: 'critical', tooltip: clip(state.trouble, LIMITS.FOOTER_TOOLTIP) })
  }
  if (work && work.count > 0) {
    const talking = work.presenting ? 'A talk is being given: step it with its own keys.' : null
    items.push({
      kind: 'run',
      id: FOOT.PREVIOUS,
      label: 'Previous slide',
      icon: 'chevron-left',
      disabled: talking ?? (work.before === null ? 'This is the first slide shown.' : null),
    })
    items.push({ kind: 'text', id: 'position', text: clip(work.position, LIMITS.FOOTER_TEXT), tooltip: clip(positionTip(work), LIMITS.FOOTER_TOOLTIP) })
    items.push({
      kind: 'run',
      id: FOOT.NEXT,
      label: 'Next slide',
      icon: 'chevron-right',
      disabled: talking ?? (work.after === null ? 'This is the last slide shown.' : null),
    })
    if (work.slides.length) {
      items.push({
        kind: 'go',
        id: FOOT.SLIDE,
        label: 'Slides',
        icon: 'layout-list',
        optional: true,
        /* An agent turns the page with the door's own tool, and is sent there. */
        tool: 'show_slide',
        options: slidesOffered(work.slides, work.current).map((one) => ({ id: `s${one.index}`, label: cut(`${one.index + 1}. ${one.headline || '(empty)'}`) })),
      })
    }
  }
  if (state.save) {
    const bad = state.save === 'conflict' || state.save === 'failed'
    items.push({ kind: 'text', id: 'save', text: WORDS[state.save], align: 'end', ...(bad ? { level: 'critical' as const } : {}), tooltip: SAID[state.save] })
  }
  if (state.deck) {
    items.push({ kind: 'text', id: 'shown', text: clip(state.deck, LIMITS.FOOTER_TEXT), align: 'end', optional: true, tooltip: clip(`The deck on show: ${state.deck}.`, LIMITS.FOOTER_TOOLTIP) })
  }
  return items
}

/** The position's tooltip: the slide in front by its headline, or why none is. */
function positionTip(work: Work): string {
  if (work.current === null) return `No slide of the ${work.count} is among those shown.`
  const headline = work.slides.find((one) => one.index === work.current)?.headline
  return headline ? `Slide ${work.current + 1} of ${work.count}: ${headline}` : `Slide ${work.current + 1} of ${work.count}.`
}
