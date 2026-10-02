import { ChevronLeft, ChevronRight, Link2, Quote } from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/button'
import type { Editor } from '@/editor/deck-editor'
import { cn } from '@/lib/utils'
import { SlideView } from '@/slides/slide-view'
import type { Decks } from '@/wire/decks'
import type { Host } from '@/wire/use-roadmap'

import type { CitationView, WatchEvent } from '../deck/api.ts'
import { addCitation } from '../deck/cite.ts'
import type { Cite } from './slides/citations.tsx'
import { parseDeck, setSection, slideAt, slideRanges, unlinkable, type Deck, type SectionLink } from '../deck/format.ts'
import { HeaderControls, OpenItYourself } from './controls.tsx'
import { absolute, linkedToReading, projectRelative, readingOf, samePath, type PassageLike, type Reading } from './follow.ts'
import { openPage, pageUrl } from './open-window.ts'
import { Stage, usePresenting } from './stage.tsx'
import { useTalk } from './talk.ts'
import { useDeck, type SaveState } from './use-deck.ts'
import { useFollowing } from './use-following.ts'

/**
 * The open deck: thumbnails, the Markdown, and the current slide.
 *
 * The caret is the one source of truth for "the current slide": the editor
 * reports it, `slideAt` maps it, and a thumbnail press moves it (and asks the
 * editor to follow). Wide, the three panes sit side by side; in a container
 * narrower than 720px they collapse to Edit / Preview tabs. That switch is a
 * container query, so the frame's own width decides, not the window's.
 *
 * The deck's header controls (following, present, PDF) are drawn into the
 * screen's header through a portal at `header`: they act on the slide on
 * screen, and that lives here.
 */
export function Workspace({
  decks,
  host,
  project,
  slug,
  watched,
  editor: EditorPane,
  theme,
  saveDelay,
  publishDelay,
  header,
  onHistory,
  onState,
}: {
  decks: Decks
  host: Host
  project: string
  slug: string
  watched: WatchEvent | null
  editor: Editor
  theme: 'light' | 'dark'
  saveDelay?: number
  /** How long a move waits before the paper is turned; tests shorten it. */
  publishDelay?: number
  /** Where the header controls go; null draws none. */
  header: HTMLElement | null
  /** The History control was pressed; the screen owns that dialog. */
  onHistory(): void
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

  const stage = useRef<HTMLDivElement>(null)
  const show = usePresenting({ stage, index: current, count: deck.slides.length, goTo })
  const [following, setFollowing] = useState(true)
  const followed = useFollowing({
    host,
    project,
    slides: deck.slides,
    current,
    ready: doc.text !== null,
    enabled: following,
    presenting: show.presenting !== null,
    goTo,
    publishDelay,
  })
  useTalk({
    decks,
    project,
    slug,
    active: show.presenting !== null,
    index: current,
    blank: show.blank,
    since: show.since,
    onMove: (to) => {
      if (to.index !== current) goTo(to.index)
      show.setBlank(to.blank)
    },
  })
  const [blocked, setBlocked] = useState<{ what: string; url: string } | null>(null)
  const open = (what: string, path: string, params: Record<string, string>) => {
    const url = pageUrl(path, { ...params, project, theme })
    setBlocked(openPage(url) ? null : { what, url })
  }

  const cited = useCitations(decks, project, slug, doc.state, watched)
  const selection = selectedRange(host.passage)
  const cite = useMemo<Cite>(() => {
    const found = new Map((cited?.[current] ?? []).map((one) => [one.label, one] as const))
    const lit = new Set(
      [...found.values()]
        .filter((one) => selection && one.at && samePath(absolute(project, one.path), selection.path) && one.at.from < selection.to && selection.from < one.at.to)
        .map((one) => one.label),
    )
    return {
      found,
      lit,
      onCite: (label) => {
        const one = found.get(label)
        if (!one?.at) return
        followed.point({ path: absolute(project, one.path), page: null, from: one.at.from, to: one.at.to, quoted: one.quote.slice(0, 2000), section: null })
      },
    }
  }, [cited, current, project, selection?.path, selection?.from, selection?.to])
  const [citeTrouble, setCiteTrouble] = useState<string | null>(null)
  const citeSelection = async () => {
    const rel = selection ? projectRelative(project, selection.path) : null
    if (!selection || !rel) return
    try {
      const quote = await decks.source(project, rel, selection.from, selection.to)
      const done = addCitation(text, current, { path: rel, quote }, { caret })
      if ('error' in done) return setCiteTrouble(done.error)
      setCiteTrouble(null)
      doc.edit(done.text)
    } catch (e) {
      setCiteTrouble(e instanceof Error ? e.message : String(e))
    }
  }

  const reading = readingOf(host.passage)
  const edit = (section: SectionLink | null) => {
    const next = setSection(text, current, section)
    if (next !== null && next !== text) doc.edit(next)
  }

  const controls = header
    ? createPortal(
        <>
          <HeaderControls
            following={following}
            presenting={show.presenting !== null}
            reading={reading}
            missing={followed.missing}
            onToggleFollowing={() => setFollowing((on) => !on)}
            onPresent={show.start}
            onPresenterView={() => open('The presenter view', './app', { presenter: slug })}
            onExport={() => open('The print view', './print', { deck: slug })}
            onHistory={onHistory}
          />
        </>,
        header,
      )
    : null

  if (doc.text === null) {
    return (
      <p className="text-muted-foreground m-auto p-6 text-xs">
        {doc.state === 'failed' ? `Could not open this deck: ${doc.error}` : 'Opening the deck…'}
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {controls}
      <Stage
        stage={stage}
        presenting={show.presenting}
        slide={slide}
        aspect={deck.aspect}
        blank={show.blank}
        note={show.note}
      />
      {blocked ? <OpenItYourself what={blocked.what} url={blocked.url} onDismiss={() => setBlocked(null)} /> : null}
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
            {slide ? (
              <SlideView
                slide={slide}
                aspect={deck.aspect}
                showSection
                onUnlink={() => edit(null)}
                cite={cite}
                className="drop-shadow-sm"
              />
            ) : null}
          </div>
          <div className="flex justify-center px-3 pb-1">
            <LinkButton project={project} reading={reading} slide={slide} onLink={edit} />
            <CiteButton project={project} selection={selection} already={cite.lit.size > 0} onCite={() => void citeSelection()} />
          </div>
          {citeTrouble ? (
            <p role="status" className="text-destructive px-3 pb-1 text-center text-[11px]">
              {citeTrouble}
            </p>
          ) : null}
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

/**
 * Link the slide on screen to the section the paper is on. The directive is
 * written into the text the editor holds, so the person sees it appear and it
 * is saved like any other edit.
 */
function LinkButton({
  project,
  reading,
  slide,
  onLink,
}: {
  project: string
  reading: Reading | null
  slide: Deck['slides'][number] | undefined
  onLink(section: SectionLink): void
}) {
  const path = reading ? projectRelative(project, reading.path) : null
  const section = reading && path ? { path, title: reading.title } : null
  const why = !reading
    ? 'The paper is not on a section.'
    : !section
      ? 'The paper’s file is not inside this project.'
      : unlinkable(section) ?? (linkedToReading(slide, project, reading) ? 'This slide is already linked to it.' : null)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground h-6 gap-1 px-2 text-[11px]"
      disabled={why !== null}
      title={why ?? `Link this slide to “${reading?.title}”`}
      onClick={() => section && onLink(section)}
    >
      <Link2 className="size-3" />
      Link to the section you're reading
    </Button>
  )
}

/** What is selected in the paper, when a range of a file is. */
function selectedRange(passage: PassageLike | null | undefined): { path: string; from: number; to: number } | null {
  if (!passage || typeof passage.from !== 'number' || typeof passage.to !== 'number' || passage.to <= passage.from) return null
  return { path: passage.path, from: passage.from, to: passage.to }
}

/** How often the citations are looked for again while a deck is open: the paper can change under it. */
const CITATIONS_EVERY_MS = 15_000

/** The open deck's citations as the store finds them, read again on each save, each change on disk, and now and then. */
function useCitations(decks: Decks, project: string, slug: string, state: SaveState, watched: WatchEvent | null): CitationView[][] | null {
  const [found, setFound] = useState<CitationView[][] | null>(null)
  const look = useCallback(() => {
    decks.citations(project, slug).then(setFound, () => {
      /* An older store without the door, or none at all: the markers are drawn unchecked. */
    })
  }, [decks, project, slug])
  useEffect(() => {
    if (state === 'saved') look()
  }, [state, watched, look])
  useEffect(() => {
    const timer = setInterval(look, CITATIONS_EVERY_MS)
    return () => clearInterval(timer)
  }, [look])
  return found
}

function CiteButton({
  project,
  selection,
  already,
  onCite,
}: {
  project: string
  selection: { path: string; from: number; to: number } | null
  already: boolean
  onCite(): void
}) {
  const why = !selection
    ? 'Select a sentence in the paper first.'
    : !projectRelative(project, selection.path)
      ? 'The paper’s file is not inside this project.'
      : already
        ? 'This slide already cites what is selected.'
        : null
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground h-6 gap-1 px-2 text-[11px]"
      disabled={why !== null}
      title={why ?? 'Cite the words selected in the paper, at the end of the line the caret is on'}
      onClick={onCite}
    >
      <Quote className="size-3" />
      Cite the selection
    </Button>
  )
}

/** Where a slide's text starts: past the blank lines after its separator. */
function firstInk(text: string, from: number, to: number): number {
  let at = from
  while (at < to && /\s/.test(text[at] ?? '')) at++
  return at < to ? at : from
}
