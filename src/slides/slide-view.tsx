import { memo, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { columns, type Aspect, type Slide } from '../../deck/format.ts'
import { CiteContext, withMarkers, type Cite } from './citations.tsx'
import { SlideMarkdown } from './markdown.tsx'

/**
 * One slide, drawn at a fixed logical size and scaled to whatever holds it.
 *
 * The slide itself (`SlideFace`) is always laid out at 1280×720 (960×720 for
 * 4:3) in CSS pixels, so the type sizes below are presentation sizes and a line
 * breaks in the same place in a 120-pixel thumbnail, the preview, full screen
 * and print. `SlideView` measures its box and applies one `transform: scale()`.
 * The same component serves every place a slide is shown.
 */

export const SLIDE_HEIGHT = 720
export function slideWidth(aspect: Aspect): number {
  return aspect === '4:3' ? 960 : 1280
}

export function SlideView({
  slide,
  aspect = '16:9',
  fit = 'contain',
  showSection = false,
  onUnlink,
  onSection,
  cite = null,
  className,
}: {
  slide: Slide
  aspect?: Aspect
  /** Given, the slide's citation markers are drawn and pressable (the editor's preview); otherwise they are left out. */
  cite?: Cite | null
  /**
   * `contain` fits the whole slide inside the box and centres it (preview,
   * presenting). `width` makes the box as tall as the slide is at the box's
   * width (thumbnails, print).
   */
  fit?: 'contain' | 'width'
  /** The small section chip: the editor's preview shows it, presented output does not. */
  showSection?: boolean
  /** Given, the section chip carries an × that unlinks the slide. */
  onUnlink?: () => void
  /** Given, the section chip is a button: pressing it turns the paper to the section. */
  onSection?: () => void
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const width = slideWidth(aspect)
  const size = useSize(box)
  const scale = size
    ? fit === 'width'
      ? size.width / width
      : Math.min(size.width / width, size.height / SLIDE_HEIGHT)
    : fit === 'width'
      ? 0.1
      : 0.5
  const left = size && fit === 'contain' ? (size.width - width * scale) / 2 : 0
  const top = size && fit === 'contain' ? (size.height - SLIDE_HEIGHT * scale) / 2 : 0

  return (
    <div
      ref={box}
      data-testid="slide-view"
      className={cn('relative overflow-hidden', fit === 'contain' ? 'size-full' : 'w-full', className)}
      style={fit === 'width' ? { aspectRatio: `${width} / ${SLIDE_HEIGHT}` } : undefined}
    >
      <div
        className="absolute origin-top-left"
        /* `--slide-scale` is for what has to stay pressable when the slide is shrunk: see `CiteMark`. */
        style={{ width, height: SLIDE_HEIGHT, left, top, transform: `scale(${scale})`, ['--slide-scale' as string]: scale }}
      >
        <CiteContext.Provider value={cite}>
          <SlideFace slide={slide} showSection={showSection} onUnlink={onUnlink} onSection={onSection} />
        </CiteContext.Provider>
      </div>
    </div>
  )
}

/** The box's content size, kept current. Null until measured (and in a DOM that does not lay out). */
function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const { width, height } = element.getBoundingClientRect()
      if (width <= 0) return
      setSize((was) => (was && was.width === width && was.height === height ? was : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * The slide at its logical size, unscaled: a full-size block of the module's
 * own tokens, so light and dark follow the host's theme. Speaker notes are not
 * part of a slide's face and are never drawn here.
 */
export const SlideFace = memo(function SlideFace({
  slide,
  showSection = false,
  onUnlink,
  onSection,
}: {
  slide: Slide
  showSection?: boolean
  onUnlink?: () => void
  onSection?: () => void
}) {
  return (
    <div
      data-layout={slide.layout}
      className="slide bg-background text-foreground relative flex size-full flex-col overflow-hidden"
    >
      <Layout slide={slide} />
      {showSection && slide.section ? (
        <span
          data-testid="section-chip"
          title={`${slide.section.path} — ${slide.section.title}`}
          className="bg-muted text-muted-foreground absolute top-6 right-6 flex max-w-[40%] items-center gap-2 rounded-full px-4 py-1.5 text-[20px]"
        >
          {onSection ? (
            <button
              type="button"
              title={`Show “${slide.section.title}” in the paper`}
              onClick={onSection}
              /* The chip is a few pixels tall in a shrunken preview: what is pressed reaches ten real pixels above and below it. */
              className="hover:text-foreground relative flex min-w-0 after:absolute after:inset-x-0 after:-inset-y-[calc(10px/var(--slide-scale,1))] after:content-['']"
            >
              <span className="truncate">§ {slide.section.title}</span>
            </button>
          ) : (
            <span className="truncate">§ {slide.section.title}</span>
          )}
          {onUnlink ? (
            /* Drawn at slide scale like the chip, so it is large in logical pixels to stay pressable when shrunk. */
            <button
              type="button"
              aria-label={`unlink from ${slide.section.title}`}
              title="Unlink this slide from the section"
              onClick={onUnlink}
              className="hover:text-foreground relative -mr-2 shrink-0 rounded-full px-2 text-[28px] leading-none"
            >
              ×
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
})

function Layout({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case 'title':
      return <TitleLayout body={slide.body} />
    case 'two-column':
      return <TwoColumnLayout body={slide.body} />
    case 'image':
      return <ImageLayout body={slide.body} />
    case 'quote':
      return <QuoteLayout body={slide.body} />
    default:
      return <BulletsLayout body={slide.body} />
  }
}

function Prose({ text, className }: { text: string; className?: string }) {
  const cite = useContext(CiteContext)
  return (
    <div className={cn('slide-prose', className)}>
      <SlideMarkdown text={withMarkers(text, cite !== null)} />
    </div>
  )
}

/** A big centred heading, and whatever follows it as the subtitle. */
function TitleLayout({ body }: { body: string }) {
  return (
    <Frame className="items-center justify-center text-center">
      <Prose text={body} className="slide-title" />
    </Frame>
  )
}

/** A heading and its content: the default slide. */
function BulletsLayout({ body }: { body: string }) {
  return (
    <Frame>
      <Prose text={body} />
    </Frame>
  )
}

/** A heading across the top, then the body split on `|||` into two columns. */
function TwoColumnLayout({ body }: { body: string }) {
  const { heading, rest } = leadingHeading(body)
  const [left, right] = columns(rest)
  return (
    <Frame>
      {heading ? <Prose text={heading} /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-16">
        <Prose text={left} className="min-w-0" />
        <Prose text={right} className="min-w-0" />
      </div>
    </Frame>
  )
}

/** One picture filling the slide; a heading above and any other text as its caption. */
function ImageLayout({ body }: { body: string }) {
  const { heading, rest } = leadingHeading(body)
  const picture = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest)
  const caption = picture ? (rest.slice(0, picture.index) + rest.slice(picture.index + picture[0].length)).trim() : rest
  return (
    <Frame className="gap-6 py-12">
      {heading ? <Prose text={heading} /> : null}
      {picture ? (
        <div className="slide-picture flex min-h-0 flex-1 items-center justify-center">
          <SlideMarkdown text={picture[0]} />
        </div>
      ) : (
        <div className="text-muted-foreground border-border flex flex-1 items-center justify-center rounded-2xl border-4 border-dashed text-[28px]">
          ![caption](picture.png)
        </div>
      )}
      {caption ? <Prose text={caption} className="slide-caption text-center" /> : null}
    </Frame>
  )
}

/** A large quotation, and its attribution beneath. */
function QuoteLayout({ body }: { body: string }) {
  return (
    <Frame className="justify-center px-40">
      <Prose text={body} className="slide-quote" />
    </Frame>
  )
}

function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col px-24 py-16', className)}>{children}</div>
}

/** A body's first line when it is a Markdown heading, and the rest. */
export function leadingHeading(body: string): { heading: string | null; rest: string } {
  const lines = body.split('\n')
  if (!/^#{1,6}\s/.test(lines[0] ?? '')) return { heading: null, rest: body }
  return { heading: lines[0] ?? null, rest: lines.slice(1).join('\n').trim() }
}
