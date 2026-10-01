import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { Editor } from '@/editor/deck-editor'
import { cn } from '@/lib/utils'
import { SlideView } from '@/slides/slide-view'
import type { Decks } from '@/wire/decks'

import type { WatchEvent } from '../deck/api.ts'
import { parseDeck, slideAt, slideRanges, type Deck } from '../deck/format.ts'
import { useDeck, type SaveState } from './use-deck.ts'

/**
 * The open deck: thumbnails, the Markdown, and the current slide.
 *
 * The caret is the one source of truth for "the current slide": the editor
 * reports it, `slideAt` maps it, and a thumbnail press moves it (and asks the
 * editor to follow). Wide, the three panes sit side by side; in a container
 * narrower than 720px they collapse to Edit / Preview tabs. That switch is a
 * container query, so the frame's own width decides, not the window's.
 */
export function Workspace({
  decks,
  project,
  slug,
  watched,
  editor: EditorPane,
  theme,
  saveDelay,
  onState,
}: {
  decks: Decks
  project: string
  slug: string
  watched: WatchEvent | null
  editor: Editor
  theme: 'light' | 'dark'
  saveDelay?: number
  onState(state: SaveState): void
}) {
  const doc = useDeck({ decks, project, slug, watched, saveDelay })
  const text = doc.text ?? ''
  const [caret, setCaret] = useState(0)
  const [jump, setJump] = useState<{ at: number; nonce: number } | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  useEffect(() => onState(doc.state), [doc.state, onState])

  /* Parsing is cheap; rendering every thumbnail is not. The panes draw from a
     deferred copy so typing never waits on them. */
  const shown = useDeferredValue(text)
  const deck = useMemo<Deck>(() => parseDeck(shown, slug), [shown, slug])
  const current = Math.min(slideAt(text, caret), deck.slides.length - 1)
  const slide = deck.slides[current] ?? deck.slides[0]

  const goTo = (index: number) => {
    const range = slideRanges(text)[index]
    if (!range) return
    const at = firstInk(text, range.from, range.to)
    setCaret(at)
    setJump((was) => ({ at, nonce: (was?.nonce ?? 0) + 1 }))
  }

  if (doc.text === null) {
    return (
      <p className="text-muted-foreground m-auto p-6 text-xs">
        {doc.state === 'failed' ? `Could not open this deck: ${doc.error}` : 'Opening the deck…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {doc.notice ? (
        <div role="status" className="bg-muted/60 flex flex-wrap items-center gap-2 border-b px-3 py-1 text-xs">
          <span className="min-w-0 flex-1">
            {doc.notice.kind === 'conflict'
              ? 'This deck was changed elsewhere before your edits were saved.'
              : 'This deck changed on disk while you were editing.'}
          </span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => void doc.reload()}>
            Reload theirs
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void doc.overwrite()}>
            Keep mine
          </Button>
        </div>
      ) : null}

      <div role="tablist" className="flex gap-1 border-b px-2 py-1 @min-[720px]:hidden">
        {(['edit', 'preview'] as const).map((one) => (
          <Button
            key={one}
            role="tab"
            aria-selected={tab === one}
            variant={tab === one ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setTab(one)}
          >
            {one === 'edit' ? 'Edit' : 'Preview'}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="slides"
          className="bg-muted/30 hidden w-40 shrink-0 flex-col gap-2 overflow-y-auto border-r p-2 @min-[720px]:flex"
        >
          {deck.slides.map((one, index) => (
            <button
              key={index}
              type="button"
              aria-label={`slide ${index + 1}`}
              aria-current={index === current ? 'true' : undefined}
              onClick={() => goTo(index)}
              className="group flex items-start gap-1.5 text-left outline-none"
            >
              <span className="text-muted-foreground w-4 shrink-0 pt-0.5 text-right text-[10px] tabular-nums">
                {index + 1}
              </span>
              <span
                className={cn(
                  'block min-w-0 flex-1 overflow-hidden rounded-sm ring-1 ring-border transition-shadow',
                  index === current ? 'ring-2 ring-ring' : 'group-hover:ring-ring/60 group-focus-visible:ring-ring',
                )}
              >
                <SlideView slide={one} aspect={deck.aspect} fit="width" />
              </span>
            </button>
          ))}
        </nav>

        <section
          aria-label="editor"
          className={cn('min-h-0 min-w-0 flex-1 @min-[720px]:block @min-[720px]:border-r', tab === 'edit' ? 'block' : 'hidden')}
        >
          <EditorPane value={text} onChange={doc.edit} onCaret={setCaret} jump={jump} theme={theme} />
        </section>

        <section
          aria-label="preview"
          className={cn(
            'bg-muted/40 min-h-0 min-w-0 flex-1 flex-col @min-[720px]:flex',
            tab === 'preview' ? 'flex' : 'hidden',
          )}
        >
          <div className="min-h-0 flex-1 p-4">
            {slide ? <SlideView slide={slide} aspect={deck.aspect} showSection className="drop-shadow-sm" /> : null}
          </div>
          <div className="text-muted-foreground flex items-center justify-center gap-1 pb-2 text-[11px] tabular-nums">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="previous slide"
              disabled={current === 0}
              onClick={() => goTo(current - 1)}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <span data-testid="position">
              {current + 1} / {deck.slides.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="next slide"
              disabled={current >= deck.slides.length - 1}
              onClick={() => goTo(current + 1)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Where a slide's text starts: past the blank lines after its separator. */
function firstInk(text: string, from: number, to: number): number {
  let at = from
  while (at < to && /\s/.test(text[at] ?? '')) at++
  return at < to ? at : from
}
