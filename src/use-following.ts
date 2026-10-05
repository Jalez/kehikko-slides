import { useCallback, useEffect, useRef, useState } from 'react'

import type { Slide } from '../deck/format.ts'
import { Follower, readingOf, type Reading } from './follow.ts'
import type { Host } from './wire/use-kehikot.ts'

/** How long the slides stay on a slide before the paper is turned to it: a run of key presses turns it once. */
export const PUBLISH_DELAY_MS = 150

/**
 * Following the paper, wired to the host and the open deck. The decisions
 * are `Follower`'s; this only feeds it the passage and the slide on screen,
 * moves to where it says, and publishes what it says, a beat later.
 */
export function useFollowing({
  host,
  project,
  slides,
  current,
  ready,
  enabled,
  presenting,
  goTo,
  publishDelay = PUBLISH_DELAY_MS,
}: {
  host: Host
  project: string
  slides: Slide[]
  current: number
  /** The deck has been read: before that there are no slides to follow with. */
  ready: boolean
  /** The person's toggle: off, neither direction happens. */
  enabled: boolean
  /** Presenting pauses following the paper; publishing carries on. */
  presenting: boolean
  goTo(index: number): void
  publishDelay?: number
}): { reading: Reading | null; missing: string | null; point: (passage: PointedPassage) => void } {
  const follower = useRef<Follower | null>(null)
  follower.current ??= new Follower()
  const [shown, setShown] = useState<{ reading: Reading | null; missing: string | null }>({ reading: null, missing: null })

  /* Read through refs, so a slide typed into the deck is not a reason to look at the paper again. */
  const situation = useRef({ slides, current, project })
  situation.current = { slides, current, project }
  const go = useRef(goTo)
  go.current = goTo

  const reading = readingOf(host.passage)
  const readingKey = reading ? `${reading.path}\0${reading.title}` : ''
  const wasEnabled = useRef(enabled)

  useEffect(() => {
    if (!ready) return
    const one = follower.current as Follower
    /* Turned back on: catch up with where the paper is now, not where it next goes. */
    if (enabled && !wasEnabled.current) one.reset()
    wasEnabled.current = enabled
    const to = one.read(reading, situation.current, enabled && !presenting)
    if (to !== null) go.current(to)
    setShown((was) =>
      was.missing === one.missing && was.reading?.title === one.reading?.title && was.reading?.path === one.reading?.path
        ? was
        : { reading: one.reading, missing: one.missing },
    )
    /* `reading` is a fresh object on every context; its key is what changing means. */
  }, [readingKey, ready, enabled, presenting])

  const previous = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef(host.request)
  request.current = host.request

  useEffect(() => {
    if (!ready) return
    const was = previous.current
    previous.current = current
    /* Opening the deck lands on a slide; that is not the person moving to it. */
    if (was === null || was === current) return
    const one = follower.current as Follower
    const passage = one.moved(current, situation.current, enabled)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!passage) return
    timer.current = setTimeout(() => {
      timer.current = null
      one.published(passage)
      setShown((s) => (s.missing === null ? s : { ...s, missing: null }))
      void request.current('passage.set', { passage }).catch(() => {
        /* Unhosted, or the host said no: the slides still move; only the paper does not. */
      })
    }, publishDelay)
  }, [current, ready, enabled, publishDelay])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /* A citation pressed: turn the paper to its exact words, and do not follow it back. */
  const point = useCallback((passage: PointedPassage) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    ;(follower.current as Follower).pointed()
    void request.current('passage.set', { passage }).catch(() => {
      /* Unhosted, or the host said no: nothing else to do. */
    })
  }, [])

  return { ...shown, point }
}

/** A range of a file, as a citation points the paper at it. */
export interface PointedPassage {
  path: string
  page: null
  from: number
  to: number
  quoted: string
  section: null
}
