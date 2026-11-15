import { pageDocument } from 'kehikot-module-protocol/serve'

import { devDocument } from '../audience-page.ts'

/** The document the audience door is given in development, as made, with Vite's transform stood in for by nothing. */
export const buildless = () => devDocument(async (_url, html) => html, 'Slides')(new URL('http://127.0.0.1:7990/audience/k'))
export { pageDocument }
