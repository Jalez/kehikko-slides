import { createContext, useContext } from 'react'

import { cn } from '@/lib/utils'

import type { CitationView } from '../../deck/api.ts'
import { replaceMarkers } from '../../deck/format.ts'

/**
 * A slide's citation markers, as the page draws them.
 *
 * A `[^1]` in a slide's body is drawn only where somebody is working on the
 * deck: the editor's preview hands its slide a `Cite`, and there each marker
 * is a small numbered button that turns the paper to the exact words it cites.
 * Everywhere else — thumbnails, presenting, the presenter view, print — there
 * is no `Cite` and the markers are taken out, because an audience is shown the
 * claim, not its bookkeeping.
 *
 * The markers reach the Markdown renderer as links to `#cite-<label>`, which
 * `markdown.tsx` hands back here: the one way into react-markdown's output that
 * needs neither raw HTML nor a plugin of our own.
 */
export interface Cite {
  /** What the store found for each of this slide's labels; missing until it answers. */
  found: ReadonlyMap<string, CitationView>
  /** Labels whose passage overlaps what is selected in the paper now. */
  lit: ReadonlySet<string>
  /** A marker was pressed. */
  onCite(label: string): void
}

export const CiteContext = createContext<Cite | null>(null)

export const CITE_HREF = '#cite-'

/** A body ready for the renderer: markers as links where they are drawn, gone where they are not. */
export function withMarkers(body: string, drawn: boolean): string {
  return replaceMarkers(body, (label) => (drawn ? `[${label}](${CITE_HREF}${label})` : ''))
}

/** What a marker says when hovered. */
export function citeTitle(label: string, found: CitationView | undefined): string {
  if (!found) return `[^${label}] has no source under Sources:`
  const where = found.at ? `${found.path}, ${found.at.line === found.at.endLine ? `line ${found.at.line}` : `lines ${found.at.line}–${found.at.endLine}`}` : found.path
  const quote = `“${found.quote.length > 160 ? `${found.quote.slice(0, 157)}…` : found.quote}”`
  if (found.status === 'holds') return `${where}\n${quote}\nPress to show it in the paper.`
  if (found.status === 'ambiguous') return `${where} — these words occur ${found.count} times; quote more.\n${quote}`
  if (found.status === 'adrift') return `${found.path} no longer has these words: the paper changed under this slide.\n${quote}`
  return `${found.path} cannot be read inside this project.\n${quote}`
}

/** One marker, drawn at slide scale (so it is large in logical pixels). */
export function CiteMark({ label }: { label: string }) {
  const cite = useContext(CiteContext)
  if (!cite) return null
  const found = cite.found.get(label)
  const broken = !found || found.status === 'adrift' || found.status === 'unreadable'
  return (
    <sup className="slide-cite">
      <button
        type="button"
        data-testid="cite-mark"
        data-status={found?.status ?? 'missing'}
        aria-label={`source ${label}`}
        title={citeTitle(label, found)}
        disabled={!found?.at}
        onClick={() => cite.onCite(label)}
        className={cn(
          'relative mx-0.5 rounded px-1.5 align-super text-[0.62em] leading-none font-semibold not-italic',
          /* The preview is the slide shrunk to fit its pane, and a marker is
             then a few pixels across. What is pressed is this, not the ink: a
             box a line tall and wider than the number, laid over the marker. */
          "after:absolute after:-inset-x-[0.6em] after:-inset-y-[1.1em] after:content-['']",
          broken
            ? 'bg-destructive/15 text-destructive line-through'
            : found.status === 'ambiguous'
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
              : 'bg-primary/10 text-primary hover:bg-primary/20',
          cite.lit.has(label) && 'ring-primary ring-2',
        )}
      >
        {label}
      </button>
    </sup>
  )
}
