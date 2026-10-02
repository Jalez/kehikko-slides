import type { SectionLink, Slide } from '../deck/format.ts'

/**
 * Following the paper, both ways, as plain logic: no React, no host, no
 * clock but the one handed in, so every loop guard is a unit test
 * (test/follow.test.ts). `use-following.ts` is the thin hook around it.
 *
 * Paths: the paper's passage names its file ABSOLUTELY; a slide's `section`
 * names it relative to the project (as the paper's `list_sections` does). The
 * two meet by joining the slide's path onto the project's directory.
 */

/** Where the paper says the reader is: an absolute path and a heading. */
export interface Reading {
  path: string
  title: string
}

/** The passage this module publishes to turn the paper to a section. */
export interface SectionPassage {
  path: string
  page: null
  from: null
  to: null
  quoted: ''
  section: { title: string; from: null; to: null }
}

/** The fields of the host's passage this reads; the protocol's `Passage` fits it. */
export interface PassageLike {
  path: string
  /** A selected range, in bytes, when there is one. */
  from?: number | null
  to?: number | null
  section?: { title: string; from?: number | null; to?: number | null } | null
}

const slashes = (path: string) => path.replace(/\\/g, '/')
const trimEnd = (path: string) => slashes(path).replace(/\/+$/, '')

/** A project-relative path made absolute against the project's directory. */
export function absolute(project: string, path: string): string {
  return `${trimEnd(project)}/${slashes(path).replace(/^(\.\/)+/, '').replace(/^\/+/, '')}`
}

/** An absolute path relative to the project, or null when it is not inside it. */
export function projectRelative(project: string, path: string): string | null {
  const root = `${trimEnd(project)}/`
  const full = slashes(path)
  if (!full.startsWith(root)) return null
  const rest = full.slice(root.length)
  return rest && !rest.split('/').includes('..') ? rest : null
}

export function samePath(a: string, b: string): boolean {
  return trimEnd(a) === trimEnd(b)
}

/** The section the host's passage says is being read, or null. */
export function readingOf(passage: PassageLike | null | undefined): Reading | null {
  if (!passage?.section?.title) return null
  return { path: passage.path, title: passage.section.title }
}

/** Whether a slide is linked to the section being read. */
export function linkedToReading(slide: Slide | undefined, project: string, reading: Reading): boolean {
  const section = slide?.section
  return !!section && section.title === reading.title && samePath(absolute(project, section.path), reading.path)
}

/** The passage that turns the paper to a slide's section. */
export function passageFor(project: string, section: SectionLink): SectionPassage {
  return {
    path: absolute(project, section.path),
    page: null,
    from: null,
    to: null,
    quoted: '',
    section: { title: section.title, from: null, to: null },
  }
}

const keyOf = (reading: Reading) => `${trimEnd(reading.path)}\0${reading.title}`

/** How long after publishing a section other readings are taken to be the paper still on its way there. */
export const ECHO_GRACE_MS = 1500

export interface Situation {
  slides: Slide[]
  /** The slide on screen now. */
  current: number
  project: string
}

/**
 * The memory both directions share. One per open deck.
 *
 * - `seen` is the last section the paper said; a context re-sent with the
 *   same one is not a change, so it moves nothing.
 * - `sent` is the last section we published. Until the paper says it back
 *   (or the grace runs out) any other reading is the paper still scrolling
 *   from where it was, and following it would pull the slides back.
 * - `steering` is the slide following moved to, so that move is not
 *   published back to the paper as if the person had made it.
 */
export class Follower {
  private seen: string | null = null
  private sent: string | null = null
  private sentAt = 0
  private steering: number | null = null
  private quietUntil = 0
  /** The section the paper is on that no slide is linked to, for the indicator. */
  missing: string | null = null
  /** The section the paper is on, for the indicator's hint. */
  reading: Reading | null = null

  constructor(private now: () => number = Date.now) {}

  /** Forget what the paper last said, so the next reading is followed even if unchanged (following turned back on). */
  reset(): void {
    this.seen = null
  }

  /**
   * The host said where the paper is. Returns the slide to go to, or null to
   * stay. `following` false (turned off, or presenting) still records the
   * reading, so turning following on later is what catches up, not a re-send.
   */
  read(reading: Reading | null, at: Situation, following: boolean): number | null {
    const key = reading ? keyOf(reading) : null
    if (key === this.seen) return null
    this.reading = reading
    if (this.now() < this.quietUntil) {
      this.seen = key
      this.missing = null
      return null
    }
    if (this.sent !== null && key !== this.sent && this.now() - this.sentAt < ECHO_GRACE_MS) return null
    this.seen = key
    if (key !== null && key === this.sent) {
      /* Our own publish coming back: the slides are already there. */
      this.sent = null
      this.missing = null
      return null
    }
    this.sent = null
    if (!reading) {
      this.missing = null
      return null
    }
    if (!following) return null
    if (linkedToReading(at.slides[at.current], at.project, reading)) {
      this.missing = null
      return null
    }
    const first = at.slides.findIndex((slide) => linkedToReading(slide, at.project, reading))
    if (first < 0) {
      this.missing = reading.title
      return null
    }
    this.missing = null
    this.steering = first
    return first
  }

  /**
   * The deck is now on slide `index`. Returns the passage to publish, or null:
   * the move was following's own, publishing is off, the slide has no section,
   * or the paper is already on it.
   */
  moved(index: number, at: Situation, publishing: boolean): SectionPassage | null {
    const steered = this.steering === index
    this.steering = null
    if (steered || !publishing) return null
    const section = at.slides[index]?.section
    if (!section) return null
    const passage = passageFor(at.project, section)
    const key = keyOf({ path: passage.path, title: section.title })
    if (key === this.seen) return null
    /* Already sent and not yet said back: sending it again is the same request twice. */
    if (key === this.sent && this.now() - this.sentAt < ECHO_GRACE_MS) return null
    return passage
  }

  /**
   * A citation was pointed at: the paper is about to turn to wherever those
   * words are, which need not be this slide's section. What it says in the
   * next moment is taken as seen and followed nowhere, or pressing a marker
   * would pull the slides to whichever slide is linked to the cited section.
   */
  pointed(): void {
    this.quietUntil = this.now() + ECHO_GRACE_MS
    this.sent = null
    this.missing = null
  }

  /** A passage was published: expect it back. */
  published(passage: SectionPassage): void {
    this.sent = keyOf({ path: passage.path, title: passage.section.title })
    this.sentAt = this.now()
    this.missing = null
  }
}
