import { markersIn, parseSource, serialiseSource, uncitable, type CitedSource } from 'kehikot-module-protocol'

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
 * - A line that is exactly `Sources:` (before `Notes:`) opens the slide's
 *   citations, one per line: `[^1]: <project-relative path> | "<exact words>"`.
 *   A `[^1]` in the body is the place on the slide that rests on that passage;
 *   a source no marker names cites the slide as a whole. By the words, not by
 *   byte offsets, for the reason sections are linked by title: words survive
 *   edits above them, and when they do not, the citation can SAY it is adrift
 *   rather than quietly point at whatever moved into its bytes. The line, its
 *   markers and the finding are `kehikot-module-protocol`'s (`citations.ts`
 *   there), shared with every module that cites; a slide's body is Markdown,
 *   so its markers are read outside code (`IN_BODY`).
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

/** One passage a slide rests on: a file of the project, and its exact words there. */
export type Source = CitedSource

/** How a slide's body is scanned for markers: it is Markdown, so a `[^1]` inside code is code. */
export const IN_BODY = { skipCode: true } as const

export interface Slide {
  layout: Layout
  section: SectionLink | null
  /** The `Sources:` block, in the order written. */
  sources: Source[]
  /** Lines under `Sources:` that are not a source, kept verbatim so a person's text survives. */
  strays: string[]
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
const SOURCES = /^Sources:[ \t]*$/m

export function emptySlide(): Slide {
  return { layout: 'bullets', section: null, sources: [], strays: [], extra: [], body: '', notes: '' }
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
  const sources = SOURCES.exec(text)
  if (sources) {
    for (const line of text.slice(sources.index + sources[0].length).split('\n')) {
      if (!line.trim()) continue
      const one = parseSource(line.trim())
      if (one) slide.sources.push(one)
      else slide.strays.push(line.trim())
    }
    text = text.slice(0, sources.index)
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
  if (slide.sources.length || slide.strays.length) {
    parts.push(['Sources:', ...slide.sources.map(serialiseSource), ...slide.strays].join('\n'))
  }
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

/**
 * The text with its front-matter `title` set, and nothing else touched: a
 * rename should not reflow a person's slides. A file with no front matter is
 * given one.
 */
export function retitle(text: string, title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  const normalised = text.replace(/\r\n/g, '\n')
  const { offset } = frontMatter(normalised)
  if (offset === 0) return `---\ntitle: ${clean}\n---\n\n${normalised.replace(/^\s*\n/, '')}`
  const lines = normalised.slice(0, offset).split('\n')
  const end = lines.findIndex((line, i) => i > 0 && SEPARATOR.test(line))
  const at = lines.findIndex((line, i) => i > 0 && i < end && /^title[ \t]*:/i.test(line))
  if (at > 0) lines[at] = `title: ${clean}`
  else lines.splice(1, 0, `title: ${clean}`)
  return lines.join('\n') + normalised.slice(offset)
}

/**
 * The text with slide `index` replaced by `slide` (one slide's Markdown,
 * directive comment and notes included), every other byte kept as it was.
 * The blank lines around the old slide are kept around the new one. Returns
 * null for an index that is not a slide.
 */
export function replaceSlide(text: string, index: number, slide: string): string | null {
  const normalised = text.replace(/\r\n/g, '\n')
  const ranges = slideRanges(normalised)
  const range = ranges[index]
  if (!Number.isInteger(index) || !range) return null
  const old = normalised.slice(range.from, range.to)
  const last = index === ranges.length - 1
  const blank = old.trim() === ''
  const lead = blank ? (range.from === 0 ? '' : '\n') : (/^\s*/.exec(old)?.[0] ?? '')
  const trail = blank ? (last ? '\n' : '\n\n') : (/\s*$/.exec(old)?.[0] ?? '')
  return normalised.slice(0, range.from) + lead + slide.trim() + trail + normalised.slice(range.to)
}

/** A slide's heading, or its first line, for a list of slides. */
export function slideHeadline(slide: Slide): string {
  const first = slide.body.split('\n').find((line) => line.trim()) ?? ''
  return first.replace(/^#+\s*/, '').trim()
}

/**
 * What is wrong with a deck's directives, one sentence per slide, counted from
 * 0. A `layout` or `section` the parser could not read is kept as an unknown
 * directive, which is right for a person's file and wrong for an agent's write:
 * the agent meant something and would never learn it did not land.
 */
export function deckProblems(text: string): string[] {
  const problems: string[] = []
  parseDeck(text).slides.forEach((slide, i) => {
    for (const [key, value] of slide.extra) {
      if (key === 'layout') problems.push(`Slide ${i}: layout "${value}" is not one of ${LAYOUTS.join(', ')}.`)
      if (key === 'section') problems.push(`Slide ${i}: section "${value}" is not "<project-relative path> | <heading title>".`)
    }
    for (const line of slide.strays) {
      problems.push(`Slide ${i}: "${line.slice(0, 80)}" under Sources: is not [^label]: <project-relative path> | "<exact words>".`)
    }
    const labels = new Set<string>()
    for (const source of slide.sources) {
      if (labels.has(source.label)) problems.push(`Slide ${i}: [^${source.label}] is given two sources.`)
      labels.add(source.label)
      const why = uncitable(source)
      if (why) problems.push(`Slide ${i}: ${why}`)
    }
    for (const label of markersIn(slide.body, IN_BODY)) {
      if (!labels.has(label)) problems.push(`Slide ${i}: [^${label}] is on the slide but has no line under Sources:.`)
    }
  })
  return problems
}

/**
 * Why a section cannot be written into a directive comment, or null when it
 * can: `|` splits path from title, `;` splits directives, `-->` ends the
 * comment. Refused rather than escaped, because the file is meant to be read.
 */
export function unlinkable(section: SectionLink): string | null {
  for (const [what, value] of [['path', section.path], ['title', section.title]] as const) {
    if (/[|;\n]|-->/.test(value)) return `The section ${what} "${value}" has | ; or --> in it, which a slide's directive comment cannot hold.`
  }
  return null
}

/**
 * The text with slide `index` linked to `section` (or unlinked, for null),
 * every other slide's bytes kept. Null for an index that is not a slide or a
 * section that cannot be written (see `unlinkable`).
 */
export function setSection(text: string, index: number, section: SectionLink | null): string | null {
  if (section && unlinkable(section)) return null
  const normalised = text.replace(/\r\n/g, '\n')
  const range = slideRanges(normalised)[index]
  if (!range) return null
  const slide = parseSlide(normalised.slice(range.from, range.to))
  return replaceSlide(normalised, index, serialiseSlide({ ...slide, section }))
}
