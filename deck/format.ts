/**
 * A deck is one Markdown file, and this is the only place that reads or writes
 * one. The server (store, MCP door) and the page (editor, preview, following)
 * all go through these functions, so there is one spelling of every rule.
 *
 * ```md
 * ---
 * title: Defence
 * epic: my-thesis
 * ---
 *
 * <!-- layout: title -->
 * # Bridging the gap
 * A thesis defence
 *
 * ---
 *
 * <!-- section: chapters/2_bridge.tex | Bridging the gap -->
 * ## The problem
 * - one
 * - two
 *
 * Notes:
 * Say why this matters before the numbers.
 * ```
 *
 * - The front matter is optional; `title` defaults to the file's name.
 * - Slides are separated by a line that is exactly `---`.
 * - A slide may open with one HTML comment of `key: value` directives, split on
 *   `;`. Known keys are `layout` and `section`; unknown keys are kept as they
 *   were written, so a person's own notes in the comment survive a round trip.
 * - `section: <project-relative path> | <heading title>` links the slide to a
 *   paper section. By title, because titles survive edits to the paper and
 *   byte offsets do not.
 * - Everything after a line that is exactly `Notes:` is speaker notes.
 * - `two-column` splits its body on a line that is exactly `|||`.
 *
 * Plain functions over strings: no I/O, so the same code runs in Bun and in the
 * page, and every rule is a unit test.
 */

export const LAYOUTS = ['title', 'bullets', 'two-column', 'image', 'quote'] as const
export type Layout = (typeof LAYOUTS)[number]

export const ASPECTS = ['16:9', '4:3'] as const
export type Aspect = (typeof ASPECTS)[number]

export interface SectionLink {
  /** Relative to the project root, as the paper's `list_sections` gives it. */
  path: string
  /** The heading's text, exactly as the paper spells it. */
  title: string
}

export interface Slide {
  layout: Layout
  section: SectionLink | null
  /** Directives this module does not know, kept verbatim in order. */
  extra: [string, string][]
  /** The Markdown the slide shows, without the directive comment or notes. */
  body: string
  notes: string
}

export interface Deck {
  title: string
  epic: string | null
  aspect: Aspect
  slides: Slide[]
}

/** Where one slide's text sits in the file, so a caret can be mapped to a slide. */
export interface SlideRange {
  from: number
  to: number
}

const SEPARATOR = /^---[ \t]*$/
const DIRECTIVE = /^<!--([\s\S]*?)-->[ \t]*(?:\r?\n|$)/
const NOTES = /^Notes:[ \t]*$/m

export function emptySlide(): Slide {
  return { layout: 'bullets', section: null, extra: [], body: '', notes: '' }
}

/** Split off the front matter, if the file opens with one. */
function frontMatter(text: string): { fields: Map<string, string>; rest: string; offset: number } {
  const fields = new Map<string, string>()
  const lines = text.split('\n')
  if (!SEPARATOR.test(lines[0] ?? '')) return { fields, rest: text, offset: 0 }
  const end = lines.findIndex((line, i) => i > 0 && SEPARATOR.test(line))
  if (end < 0) return { fields, rest: text, offset: 0 }
  /* Only a block of `key: value` lines is front matter. A deck whose first
     slide is just separated from nothing by a stray `---` must not lose that
     slide's text to a header nobody wrote. */
  const inner = lines.slice(1, end)
  if (!inner.every((line) => line.trim() === '' || /^[A-Za-z][\w-]*:/.test(line))) {
    return { fields, rest: text, offset: 0 }
  }
  for (const line of inner) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim())
  }
  const consumed = lines.slice(0, end + 1).join('\n').length + 1
  return { fields, rest: text.slice(Math.min(consumed, text.length)), offset: Math.min(consumed, text.length) }
}

/** The ranges of each slide's text within `text`, front matter excluded. */
export function slideRanges(text: string): SlideRange[] {
  const { offset } = frontMatter(text)
  const ranges: SlideRange[] = []
  let start = offset
  let at = offset
  for (const line of text.slice(offset).split('\n')) {
    const end = at + line.length
    if (SEPARATOR.test(line)) {
      ranges.push({ from: start, to: at })
      start = Math.min(end + 1, text.length)
    }
    at = end + 1
  }
  ranges.push({ from: start, to: text.length })
  /* A file that is only front matter, or ends in a separator, has an empty
     last range; an empty deck is one empty slide, not none. */
  return ranges
}

/** Which slide a caret position falls in. */
export function slideAt(text: string, caret: number): number {
  const ranges = slideRanges(text)
  const i = ranges.findIndex((r) => caret <= r.to)
  return i < 0 ? ranges.length - 1 : i
}

function parseSection(value: string): SectionLink | null {
  const bar = value.indexOf('|')
  if (bar < 0) return null
  const path = value.slice(0, bar).trim()
  const title = value.slice(bar + 1).trim()
  return path && title ? { path, title } : null
}

export function parseSlide(raw: string): Slide {
  const slide = emptySlide()
  let text = raw.replace(/^\s*\n/, '')
  const directive = DIRECTIVE.exec(text)
  if (directive) {
    text = text.slice(directive[0].length)
    for (const part of (directive[1] ?? '').split(';')) {
      const at = part.indexOf(':')
      if (at < 0) {
        if (part.trim()) slide.extra.push([part.trim(), ''])
        continue
      }
      const key = part.slice(0, at).trim().toLowerCase()
      const value = part.slice(at + 1).trim()
      if (key === 'layout' && (LAYOUTS as readonly string[]).includes(value)) slide.layout = value as Layout
      else if (key === 'section' && parseSection(value)) slide.section = parseSection(value)
      else slide.extra.push([key, value])
    }
  }
  const notes = NOTES.exec(text)
  if (notes) {
    slide.notes = text.slice(notes.index + notes[0].length).trim()
    text = text.slice(0, notes.index)
  }
  slide.body = text.trim()
  return slide
}

export function parseDeck(text: string, fallbackTitle = 'Untitled deck'): Deck {
  const normalised = text.replace(/\r\n/g, '\n')
  const { fields } = frontMatter(normalised)
  const aspect = fields.get('aspect')
  const epic = fields.get('epic')
  const slides = slideRanges(normalised).map((r) => parseSlide(normalised.slice(r.from, r.to)))
  return {
    title: fields.get('title') || fallbackTitle,
    epic: epic ? epic : null,
    aspect: aspect && (ASPECTS as readonly string[]).includes(aspect) ? (aspect as Aspect) : '16:9',
    slides: slides.length ? slides : [emptySlide()],
  }
}

export function serialiseSlide(slide: Slide): string {
  const directives: string[] = []
  if (slide.layout !== 'bullets') directives.push(`layout: ${slide.layout}`)
  if (slide.section) directives.push(`section: ${slide.section.path} | ${slide.section.title}`)
  for (const [key, value] of slide.extra) directives.push(value ? `${key}: ${value}` : key)
  const parts: string[] = []
  if (directives.length) parts.push(`<!-- ${directives.join('; ')} -->`)
  if (slide.body.trim()) parts.push(slide.body.trim())
  if (slide.notes.trim()) parts.push(`Notes:\n${slide.notes.trim()}`)
  return parts.join('\n')
}

export function serialiseDeck(deck: Deck): string {
  const head = ['---', `title: ${deck.title}`]
  if (deck.epic) head.push(`epic: ${deck.epic}`)
  if (deck.aspect !== '16:9') head.push(`aspect: ${deck.aspect}`)
  head.push('---')
  const slides = deck.slides.map(serialiseSlide)
  return `${head.join('\n')}\n\n${slides.join('\n\n---\n\n')}\n`
}

/** The two columns of a `two-column` slide's body. */
export function columns(body: string): [string, string] {
  const at = body.split('\n').findIndex((line) => /^\|\|\|[ \t]*$/.test(line))
  if (at < 0) return [body, '']
  const lines = body.split('\n')
  return [lines.slice(0, at).join('\n').trim(), lines.slice(at + 1).join('\n').trim()]
}

/** A file name for a deck title: lowercase words joined by dashes. */
export function slugFor(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'deck'
  )
}

/** Whether a slide is linked to this section — same path, same title. */
export function linkedTo(slide: Slide, path: string, title: string): boolean {
  return slide.section !== null && slide.section.path === path && slide.section.title === title
}
