import { follow, type Attachment } from 'kehikot-module-protocol/client'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Watching } from '@/slides/markdown'
import { SlideView } from '@/slides/slide-view'

import { AUDIENCE_PREFIX, type AudienceEvent, type AudienceState } from '../deck/api.ts'
import { emptySlide } from '../deck/format.ts'

/**
 * The audience view, at `/audience/<key>`: the slide the presenter is on, as large as the window allows with the
 * deck's own proportions, on black. No notes, no controls, no Kehikot around it, and nothing on it can change
 * anything: the page is handed no ticket, and its one door is `audience.ts`, which only reads.
 *
 * It follows the presenter over one server-sent-event stream, which sends the whole state as it opens and after
 * every drop, so a window that was asleep, or opened late, is on the right slide at once. It never asks on a clock.
 * What it says, it says quietly: "Press F for full screen" until it is used, "Presenter disconnected" while the
 * presenter's window is closed (the last slide stays), "Reconnecting…" while this page's own connection is down.
 */

/** How long the hint and the pointer stay once something moved. */
export const HINT_MS = 4000

export const WORDS = {
  fullScreen: 'Press F for full screen',
  away: 'Presenter disconnected',
  reconnecting: 'Reconnecting…',
  over: 'This link is no longer active.',
  renewed: 'The presenter made a new link, so this one has stopped.',
  waiting: 'Waiting for the presenter…',
} as const

type Following = (path: string, onEvent: (event: AudienceEvent) => void, options: { onAttachment: (attachment: Attachment) => void }) => () => void

/** Whether the link still works: the one question this page asks when its stream drops. */
type Alive = (key: string) => Promise<boolean>

const asked: Alive = async (key) => {
  try {
    return (await fetch(`${AUDIENCE_PREFIX}${key}/alive`, { cache: 'no-store' })).ok
  } catch {
    /* Nothing answered: the server is between processes. The stream retries by itself. */
    return true
  }
}

export function AudienceView({
  linkKey,
  following = follow as Following,
  alive = asked,
}: {
  linkKey: string
  following?: Following
  alive?: Alive
}) {
  const [state, setState] = useState<AudienceState | null>(null)
  const [ended, setEnded] = useState<'renewed' | 'over' | null>(null)
  const [attached, setAttached] = useState<Attachment>('connecting')
  const [hint, setHint] = useState(true)
  const [full, setFull] = useState(false)
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let stop = () => {}
    const off = following(
      `${AUDIENCE_PREFIX}${linkKey}/events`,
      (event) => {
        if ('ended' in event && event.ended) {
          setEnded(event.why)
          stop()
          return
        }
        setState(event as AudienceState)
      },
      {
        onAttachment: (now) => {
          setAttached(now)
          /* A drop is either the server being busy or the link being over; this is how to tell. */
          if (now === 'detached') void alive(linkKey).then((works) => !works && (setEnded('over'), stop()))
        },
      },
    )
    stop = off
    return off
  }, [following, alive, linkKey])

  /* The hint and the pointer show while something moves and go a few seconds after. */
  useEffect(() => {
    const wake = () => {
      setHint(true)
      if (quiet.current) clearTimeout(quiet.current)
      quiet.current = setTimeout(() => setHint(false), HINT_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('touchstart', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('touchstart', wake)
      if (quiet.current) clearTimeout(quiet.current)
    }
  }, [])

  useEffect(() => {
    const change = () => setFull(document.fullscreenElement !== null)
    const key = (event: KeyboardEvent) => {
      if ((event.key !== 'f' && event.key !== 'F') || event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch(() => {
        /* A browser that will not: the hint stays and nothing else happens. */
      })
    }
    document.addEventListener('fullscreenchange', change)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('fullscreenchange', change)
      window.removeEventListener('keydown', key)
    }
  }, [])

  const watching = useMemo(() => ({ picture: (path: string) => `${AUDIENCE_PREFIX}${linkKey}/asset?${new URLSearchParams({ path })}` }), [linkKey])
  const slide = useMemo(() => (state?.slide ? { ...emptySlide(), layout: state.slide.layout, body: state.slide.body } : null), [state?.slide])

  return (
    <div data-testid="audience" className={`fixed inset-0 overflow-hidden bg-black text-white ${hint ? '' : 'cursor-none'}`}>
      {ended ? (
        <Say big>{ended === 'renewed' ? WORDS.renewed : WORDS.over}</Say>
      ) : state === null ? (
        <Say big>{WORDS.waiting}</Say>
      ) : slide ? (
        <Watching.Provider value={watching}>
          <SlideView slide={slide} aspect={state.aspect} />
        </Watching.Provider>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-1 text-xs text-white/70">
        {!ended && state && !state.presenter ? <Note testid="away">{WORDS.away}</Note> : null}
        {!ended && attached === 'detached' ? <Note testid="reconnecting">{WORDS.reconnecting}</Note> : null}
        {!full && hint && !ended ? <Note testid="hint">{WORDS.fullScreen}</Note> : null}
      </div>
    </div>
  )
}

function Note({ children, testid }: { children: string; testid: string }) {
  return (
    <span data-testid={testid} className="rounded-full bg-black/60 px-3 py-1">
      {children}
    </span>
  )
}

function Say({ children, big }: { children: string; big?: boolean }) {
  return <p className={`flex size-full items-center justify-center p-8 text-center text-white/70 ${big ? 'text-lg' : 'text-sm'}`}>{children}</p>
}
