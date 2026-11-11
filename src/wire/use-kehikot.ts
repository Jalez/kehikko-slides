import { useRef, useState, type MutableRefObject } from 'react'

import type { FooterItemInput, HeaderItemInput } from 'kehikot-module-protocol'
import { useHost, type Host as ProtocolHost, type KeepsFor } from 'kehikot-module-protocol/client/react'

import type { PassageLike } from '../follow.ts'
import { ID } from '../../manifest.ts'

/** One press on a header item, or a footer item (`place: 'footer'`): nothing or `true` for "taken", a sentence for "not taken, and why". */
export type Press = (press: { item: string; value?: string | boolean; place?: 'header' | 'footer' }) => string | boolean | void

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
 * `footer` and `drawsFooter` are the same for the row at the bottom (2.38.0), with no fallback: a host that
 * does not say it draws a footer is told none, and the page draws its own.
 */
export type Host = Pick<ProtocolHost, 'where' | 'project' | 'projectPath' | 'projectId' | 'epic' | 'theme' | 'parts' | 'request'> & Partial<KeepsFor> & {
  /** Whether the host draws this page's header: its greeting says (1.4.0), `null` from one that does not. */
  drawsHeader: boolean | null
  passage: PassageLike | null
  header(items: HeaderItemInput[]): void
  /** Whether the host draws this page's footer: its greeting says (2.38.0), `null` from one that does not. */
  drawsFooter: boolean | null
  /** Declares the footer for the host to draw (`kehikot.footer`); only when `drawsFooter` is true. */
  footer(items: FooterItemInput[]): void
  /** Say the page is drawn (protocol 2.70.0): the host's cover, held until then, comes off. Optional so a test host can leave it out. */
  ready?: ProtocolHost['ready']
  /** Protocol 2.84.0: say the page is reading what a switch asks for; the host may cover it in these words. */
  loading?: ProtocolHost['loading']
  presses: MutableRefObject<Press | null>
  pressed: boolean
  /** `address.open` (protocol 2.16.0): present with a host that greeted; `answers` says whether it takes addresses. */
  openAddress?: ProtocolHost['openAddress']
  answers?: ProtocolHost['answers']
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
  }, /* The kept view (protocol 2.70.0): the pane. Not the deck (kept by its slug already, and an index here), nor following (a press starts it). */ { keepView: { except: ['deck', 'following'] } })
  /* The same object the protocol hands back, with three more fields: a screen reads it as one thing. */
  return Object.assign(host, { presses, pressed })
}

/**
 * Where the container's view is kept (protocol 2.51.0): the host's kept state, one key per field,
 * per container and across restarts. A plain test host without `kept`/`read`/`remember` keeps it in
 * the component instead, as `useState` did; the protocol's `useHost` always has all three.
 */
export function useKeeps(host: Host): KeepsFor {
  const [local, setLocal] = useState<unknown>(null)
  const latest = useRef(local)
  latest.current = local
  if (host.read && host.remember) return host as KeepsFor
  return {
    kept: local,
    read: () => ({ kept: latest.current }),
    remember: (next: never) => {
      latest.current = next
      setLocal(next)
    },
  }
}
