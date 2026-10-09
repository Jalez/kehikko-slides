import { normaliseQuote, uncitable } from 'kehikot-module-protocol'

import { parseSlide, replaceSlide, serialiseSlide, slideRanges } from './format.ts'

/**
 * Citing: putting a source line and its marker on a slide.
 *
 * What a citation IS — the line, the markers, finding the words again and the
 * four answers (`holds`, `ambiguous`, `adrift`, `unreadable`) — is
 * `kehikot-module-protocol`'s, shared with every module that cites. What is
 * here is the part only a deck has: where on a slide the marker goes. Pure
 * functions over strings, like format.ts.
 */

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
