import { Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SLIDE_HEIGHT, SlideFace, slideWidth } from '@/slides/slide-view'
import { decks as realDecks, type Decks } from '@/wire/decks'

import { parseDeck, type Aspect } from '../deck/format.ts'

/** The page rule for one slide per sheet, at the slide's own size, so a PDF page is a slide. */
export function printCss(aspect: Aspect): string {
  return [
    `@page { size: ${slideWidth(aspect)}px ${SLIDE_HEIGHT}px; margin: 0; }`,
    '@media print {',
    '  html, body { margin: 0; padding: 0; background: none; }',
    '  .print-chrome { display: none !important; }',
    '  .print-deck { gap: 0 !important; padding: 0 !important; }',
    '}',
    '.print-slide { break-after: page; break-inside: avoid; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '.print-slide:last-child { break-after: auto; }',
  ].join('\n')
}

/** Fonts loaded and two frames drawn: KaTeX and the slide fonts are on the page before the print dialog snapshots it. */
export async function settled(): Promise<void> {
  await document.fonts?.ready
  await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
}

const printPage = () => window.print()

/**
 * The print view, at `/print?deck=<deck>&project=<dir>`: every slide at its
 * logical size, one per page, and the browser's print dialog opened once the
 * page has settled — "Save as PDF" there is the export. The same `SlideFace`
 * the preview draws, so the PDF matches what was on screen.
 */
export function PrintView({
  project,
  slug,
  decks = realDecks,
  print = printPage,
  ready = settled,
}: {
  project: string | null
  slug: string
  decks?: Decks
  print?: () => void
  ready?: () => Promise<void>
}) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!project || !slug) return
    decks
      .read(project, slug)
      .then((read) => setText(read.text))
      .catch((caught: unknown) => setFailed(caught instanceof Error ? caught.message : String(caught)))
  }, [decks, project, slug])

  const deck = useMemo(() => (text === null ? null : parseDeck(text, slug)), [text, slug])

  useEffect(() => {
    if (!deck) return
    document.title = `${deck.title} — Slides`
    let alive = true
    void ready().then(() => alive && print())
    return () => {
      alive = false
    }
  }, [deck, print, ready])

  if (!project || !slug) return <p className="p-6 text-xs">This print view needs a deck and a project in its address. Open it from Slides.</p>
  if (failed) return <p className="text-destructive p-6 text-xs">Could not open this deck: {failed}</p>
  if (!deck) return <p className="text-muted-foreground p-6 text-xs">Opening the deck…</p>

  const width = slideWidth(deck.aspect)
  return (
    <div className="bg-muted min-h-screen">
      <style>{printCss(deck.aspect)}</style>
      <div className="print-chrome bg-background sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium">{deck.title}</span>
        <span className="text-muted-foreground">
          {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}. Choose “Save as PDF” in the print dialog.
        </span>
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={print}>
          <Printer className="size-3.5" />
          Print
        </Button>
      </div>
      <div className="print-deck flex flex-col items-center gap-6 p-6">
        {deck.slides.map((slide, index) => (
          <div key={index} data-testid="print-slide" className="print-slide shrink-0" style={{ width, height: SLIDE_HEIGHT }}>
            <SlideFace slide={slide} />
          </div>
        ))}
      </div>
    </div>
  )
}
