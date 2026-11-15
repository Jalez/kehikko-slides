import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { frameOrigins, fillPage, pageDocument } from 'kehikot-module-protocol/serve'
import { readiness } from 'kehikot-module-protocol/build'

import type { AudienceDoorOptions } from './audience.ts'

/**
 * The document an audience page is served: the module's own page (the same bundle, which draws a slide the same
 * way everywhere), with NO ticket in it. The write ticket is what lets `/app` change a deck; this document is
 * handed to anybody holding a link, so it carries none, and the audience route draws a slide and nothing else.
 */

/** From the built page: `dist/index.html` as built, with the frame origins in and no ticket. Refused when the build is not this commit's, as `run` refuses it. */
export function builtDocument(dir: string, commit: string | null): AudienceDoorOptions['document'] {
  const dist = join(dir, 'dist')
  return async () => {
    const now = readiness(dir, dist, commit)
    if (!now.ok) throw new Error(now.why)
    /* Built with a relative base for a page at `/app`; at `/audience/<key>` the files are at the root. */
    const html = readFileSync(join(dist, 'index.html'), 'utf8').replaceAll('"./assets/', '"/assets/')
    return fillPage(html, { origins: frameOrigins(process.env) })
  }
}

/** From Vite: the same shell `doors()` makes for `/app`, run through the dev server's own transform. */
export function devDocument(
  transform: (url: string, html: string) => Promise<string>,
  title: string,
): AudienceDoorOptions['document'] {
  return (url) => transform(url.pathname, pageDocument({ title, origins: frameOrigins(process.env) }))
}
