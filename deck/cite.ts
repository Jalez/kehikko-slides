import { parseSlide, replaceSlide, serialiseSlide, slideRanges, uncitable, type Source } from './format.ts'

/**
 * Citations: which exact words of which file a slide rests on, found again.
 *
 * A source is written down as its words (see format.ts), and this is where
 * the words are looked for. Pure functions over strings, like format.ts: the
 * store reads the file and hands its text in, so every rule here is a unit test
 * and the page and the server share one spelling of "found".
 *
 * ## Why whitespace is not significant, and nothing else is forgiven
 *
 * A paper's source wraps its sentences wherever its editor did, and a quote on
 * a slide is one line. So a run of whitespace in the quote matches any run of
 * whitespace in the file, and that is the only latitude. Forgiving more — case,
 * punctuation, LaTeX markup — would let a quote match words the paper no longer
 * says, which is the one failure a citation exists to make visible.
 *
 * ## The four answers
 *
 * - `holds`: the words are in the file exactly once. The range is where.
 * - `ambiguous`: they are in it more than once. The range is the first, and the
 *   fix is a longer quote; a citation that could mean two places means neither.
 * - `adrift`: they are not in it. The paper changed under the slide.
 * - `unreadable`: the file is not there, or not inside the project.
 */

export type CiteStatus = 'holds' | 'ambiguous' | 'adrift' | 'unreadable'

/** Where a quote was found: UTF-8 byte offsets (what a passage carries) and 1-based lines. */
export interface Found {
  from: number
  to: number
  line: number
  endLine: number
}

export interface Resolved extends Source {
  status: CiteStatus
  /** Null unless the words were found. */
  at: Found | null
  /** How many times the words occur in the file. */
  count: number
}

/** A quote's words as they are compared: one space between runs, no ends. */
export function normaliseQuote(quote: string): string {
  return quote.replace(/\s+/g, ' ').trim()
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).length

function lineOf(text: string, at: number): number {
  let line = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) line++
  return line
}

/** Where `quote` is in `file`, and how many times. */
export function findQuote(file: string, quote: string): { count: number; at: Found | null } {
  const words = normaliseQuote(quote).split(' ').filter(Boolean)
  if (!words.length) return { count: 0, at: null }
  const pattern = new RegExp(words.map(escape).join('\\s+'), 'g')
  let count = 0
  let at: Found | null = null
  for (const match of file.matchAll(pattern)) {
    count++
    if (at) continue
    const start = match.index
    const end = start + match[0].length
    at = { from: bytes(file.slice(0, start)), to: bytes(file.slice(0, end)), line: lineOf(file, start), endLine: lineOf(file, end - 1) }
  }
  return { count, at }
}

/** A source, looked for in its file's text (null: the file could not be read). */
export function resolveSource(source: Source, file: string | null): Resolved {
  if (file === null) return { ...source, status: 'unreadable', at: null, count: 0 }
  const { count, at } = findQuote(file, source.quote)
  return { ...source, status: count === 0 ? 'adrift' : count === 1 ? 'holds' : 'ambiguous', at, count }
}

/** "lines 31–33" or "line 31". */
export function linesOf(at: Found): string {
  return at.line === at.endLine ? `line ${at.line}` : `lines ${at.line}–${at.endLine}`
}

/** Where on a slide the marker goes: after some exact words of its body, at the end of the caret's line, or nowhere (the slide as a whole). */
export type Place = { after: string } | { caret: number } | { whole: true }

/**
 * The deck's text with slide `index` citing `cited`: a source line added (or
 * an existing one for the same words reused) and its marker placed. Every
 * other slide's bytes are kept. A sentence instead when it cannot be done.
 */
export function addCitation(
  text: string,
  index: number,
  cited: { path: string; quote: string },
  place: Place,
): { text: string; label: string } | { error: string } {
  const normalised = text.replace(/\r\n/g, '\n')
  const ranges = slideRanges(normalised)
  const range = ranges[index]
  if (!Number.isInteger(index) || !range) return { error: `There is no slide ${index}.` }
  const quote = normaliseQuote(cited.quote)
  const why = uncitable({ path: cited.path, quote })
  if (why) return { error: `Not cited: ${why}` }
  const slide = parseSlide(normalised.slice(range.from, range.to))

  const same = slide.sources.find((one) => one.path === cited.path && normaliseQuote(one.quote) === quote)
  const label = same?.label ?? String(1 + Math.max(0, ...slide.sources.map((one) => Number(one.label)).filter(Number.isFinite)))
  const marker = `[^${label}]`
  const sources = same ? slide.sources : [...slide.sources, { label, path: cited.path, quote }]

  let body = slide.body
  if ('after' in place) {
    const words = place.after
    const first = words ? body.indexOf(words) : -1
    if (!words || first < 0) return { error: `"${words.slice(0, 80)}" is not on slide ${index}; give words exactly as the slide has them.` }
    if (body.indexOf(words, first + 1) >= 0) return { error: `"${words.slice(0, 80)}" is on slide ${index} more than once; give more of it.` }
    const end = first + words.length
    if (!body.startsWith(marker, end)) body = body.slice(0, end) + marker + body.slice(end)
  } else if ('caret' in place) {
    const lineStart = normalised.lastIndexOf('\n', Math.max(0, place.caret - 1)) + 1
    const lineEnd = normalised.indexOf('\n', place.caret)
    const line = normalised.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    const lines = body.split('\n')
    const at = line.trim() ? lines.findIndex((one) => one === line) : -1
    /* The caret off the body (on the directive, a source, the notes) cites the slide as a whole. */
    if (at >= 0 && !lines[at]!.trimEnd().endsWith(marker)) lines[at] = lines[at]!.trimEnd() + marker
    body = lines.join('\n')
  }

  const next = replaceSlide(normalised, index, serialiseSlide({ ...slide, body, sources }))
  return next === null ? { error: `There is no slide ${index}.` } : { text: next, label }
}
