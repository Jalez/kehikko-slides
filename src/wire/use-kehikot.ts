import { useRef, useState, type MutableRefObject } from 'react'

import type { HeaderItemInput } from 'kehikot-module-protocol'
import { useHost, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'

import type { PassageLike } from '../follow.ts'
import { ID } from '../../manifest.ts'

/** One press on a header item: nothing or `true` for "taken", a sentence for "not taken, and why". */
export type Press = (press: { item: string; value?: string | boolean }) => string | boolean | void

/**
 * What the screen needs from the host. The protocol's `useHost` has already put the theme on
 * <html> and flattened the context; this names the fields this module reads, so a screen can be
 * rendered in a test with a plain object.
 *
 * `passage` is what the reader is pointing at in whichever container they are reading (a paper
 * section, usually); `null` is nothing, and also a host that never says. `parts` are the parts of
 * the open epic, each with the files it lives in; empty is "not divided", and also a host from
 * before parts.
 *
 * `header` declares this page's controls for the host to draw in the container's own row
 * (`kehikot.header`); `presses` is where the screen puts what takes a press on one; `pressed` is
 * whether a host has ever sent one — which only a host that draws the header does. `drawsHeader` is the host's
 * own word for it (1.4.0): `true`, `false`, or `null` from a host that does not say, and then `pressed` decides.
 */
export type Host = Pick<ProtocolHost, 'where' | 'project' | 'projectPath' | 'epic' | 'theme' | 'parts' | 'request'> & {
  /** Whether the host draws this page's header: its greeting says (1.4.0), `null` from one that does not. */
  drawsHeader: boolean | null
  passage: PassageLike | null
  header(items: HeaderItemInput[]): void
  presses: MutableRefObject<Press | null>
  pressed: boolean
}

const DRAWN_KEY = 'kehikot.slides.header-drawn'

/** Whether a host has ever pressed a header item on this page's origin: such a host draws the header. */
function headerDrawn(): boolean {
  try {
    return window.localStorage.getItem(DRAWN_KEY) === 'yes'
  } catch {
    return false
  }
}

export function useKehikot(): Host {
  const presses = useRef<Press | null>(null)
  const [pressed, setPressed] = useState(headerDrawn)
  const host = useHost(ID, {
    onPress: (press) => {
      try {
        window.localStorage.setItem(DRAWN_KEY, 'yes')
      } catch {
        /* Remembered for this page's life all the same. */
      }
      setPressed(true)
      return presses.current ? presses.current(press) : 'No deck is open here yet.'
    },
  })
  /* The same object the protocol hands back, with three more fields: a screen reads it as one thing. */
  return Object.assign(host, { presses, pressed })
}
