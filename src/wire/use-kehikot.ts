import { useHost, type Host as ProtocolHost } from 'kehikot-module-protocol/client/react'

import type { PassageLike } from '../follow.ts'
import { ID } from '../../manifest.ts'

/**
 * What the screen needs from the host. The protocol's `useHost` has already put the theme on
 * <html> and flattened the context; this names the fields this module reads, so a screen can be
 * rendered in a test with a plain object.
 *
 * `passage` is what the reader is pointing at in whichever container they are reading (a paper
 * section, usually); `null` is nothing, and also a host that never says. `parts` are the parts of
 * the open epic, each with the files it lives in; empty is "not divided", and also a host from
 * before parts.
 */
export type Host = Pick<ProtocolHost, 'where' | 'project' | 'projectPath' | 'epic' | 'theme' | 'parts' | 'request'> & {
  passage: PassageLike | null
}

export function useKehikot(): Host {
  return useHost(ID)
}
