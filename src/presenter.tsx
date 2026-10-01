import { ChevronLeft, ChevronRight, RotateCcw, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { SlideView } from '@/slides/slide-view'
import { decks as realDecks, type Decks } from '@/wire/decks'

import { parseDeck } from '../deck/format.ts'
import { step, talkKey, useTalk } from './talk.ts'

/**
 * The presenter view, at `/app?presenter=<deck>&project=<dir>`: the slide
 * on screen, the next one, the notes, a timer and the controls. A window of
 * its own with no host, so it reads the deck and follows the talk straight
 * from the slides server — which is also what keeps it in step with the stage
 * when one window is in the desktop app and the other in a browser.
 */
export function PresenterView({
  project,
  slug,
  decks = realDecks,
  now = Date.now,
}: {
  project: string | null
  slug: string
  decks?: Decks
  now?: () => number
}) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [at, setAt] = useState<{ index: number; blank: boolean } | null>(null)
  const [started, setStarted] = useState(now)
  const [tick, setTick] = useState(now)

  useEffect(() => {
    if (!project || !slug) return
    let alive = true
    const load = () =>
      decks
        .read(project, slug)
        .then((read) => alive && (setText(read.text), setFailed(null)))
        .catch((caught: unknown) => alive && setFailed(caught instanceof Error ? caught.message : String(caught)))
    void load()
    /* Edited while the talk is on (a typo fixed in the other window): show the fix. */
    const stop = decks.watch(project, (event) => {
      if (event.slug === slug) void load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [decks, project, slug])

  useEffect(() => {
    const timer = setInterval(() => setTick(now()), 1000)
    return () => clearInterval(timer)
  }, [now])

  const deck = useMemo(() => parseDeck(text ?? '', slug), [text, slug])
  const count = deck.slides.length
  const index = at ? Math.min(at.index, count - 1) : null

  useTalk({
    decks,
    project,
    slug,
    active: true,
    index,
    blank: at?.blank ?? false,
    since: null,
    onMove: setAt,
  })

  const move = (to: { index: number; blank: boolean }) => setAt(to)
  const position = at ?? { index: 0, blank: false }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = talkKey(event.key)
      if (!key || key === 'leave' || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      setAt((was) => step(key, was ?? { index: 0, blank: false }, count))
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [count])

  if (!project || !slug) {
    return <Message>This presenter view needs a deck and a project in its address. Open it from Slides.</Message>
  }
  if (failed) return <Message>Could not open this deck: {failed}</Message>
  if (text === null) return <Message>Opening the deck…</Message>

  const current = deck.slides[position.index] ?? deck.slides[0]
  const next = deck.slides[position.index + 1]
  const elapsed = Math.max(0, Math.floor((tick - started) / 1000))

  return (
    <div className="bg-background text-foreground flex h-screen flex-col gap-3 p-3 text-sm">
      <header className="flex items-center gap-2">
        <span className="text-xs font-medium">{deck.title}</span>
        <span data-testid="presenter-position" className="text-muted-foreground text-xs tabular-nums">
          slide {position.index + 1} / {count}
          {position.blank ? ' · blank' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span data-testid="timer" className="font-mono text-lg tabular-nums" aria-label="elapsed">
            {clock(elapsed)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="reset timer"
            onClick={() => {
              const t = now()
              setStarted(t)
              setTick(t)
            }}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-3">
        <section aria-label="current slide" className="bg-muted/40 min-h-0 rounded-md p-2">
          {current && !position.blank ? (
            <SlideView slide={current} aspect={deck.aspect} />
          ) : (
            <div className="flex size-full items-center justify-center rounded bg-black text-xs text-white/60">blank</div>
          )}
        </section>
        <div className="flex min-h-0 flex-col gap-3">
          <section aria-label="next slide" className="bg-muted/40 shrink-0 rounded-md p-2">
            <p className="text-muted-foreground mb-1 text-[11px]">Next</p>
            {next ? (
              <SlideView slide={next} aspect={deck.aspect} fit="width" />
            ) : (
              <p className="text-muted-foreground py-6 text-center text-xs">The end of the deck.</p>
            )}
          </section>
          <section aria-label="notes" className="min-h-0 flex-1 overflow-y-auto rounded-md border p-3">
            {current?.notes ? (
              <p className="text-base leading-relaxed whitespace-pre-wrap">{current.notes}</p>
            ) : (
              <p className="text-muted-foreground text-xs">No notes for this slide.</p>
            )}
          </section>
        </div>
      </div>
      <footer className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          aria-label="previous slide"
          disabled={position.index === 0}
          onClick={() => move(step('previous', position, count))}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button
          variant={position.blank ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1"
          aria-pressed={position.blank}
          onClick={() => move(step('blank', position, count))}
        >
          <Square className="size-4" />
          Blank
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          aria-label="next slide"
          disabled={position.index >= count - 1}
          onClick={() => move(step('next', position, count))}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </footer>
    </div>
  )
}

/** Seconds as m:ss, or h:mm:ss past the hour. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground m-auto max-w-sm p-6 text-center text-xs">{children}</p>
}
