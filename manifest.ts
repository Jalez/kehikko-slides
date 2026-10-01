import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.slides'
export const VERSION = '0.1.0'

/**
 * Where this module would like to answer. Said once, here, and read by
 * `vite.config.ts` and `register.ts`. Modules on this machine sit ten apart, so
 * a drift up from one never lands on a neighbour's number.
 */
export const PREFERRED_PORT = 7990

/**
 * Parsed rather than shipped as a bare object: the cheapest way to learn this
 * file says something no host will accept is to fail when it is imported.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Slides',
  version: VERSION,
  summary: 'What Slides is, in a sentence, for a person deciding whether to place it.',
  /* What this module's PRESENCE obliges an agent to do. Composed into every
     agent's prompt on the canvas, so write it to somebody who just arrived. */
  guidance:
    'This canvas has Slides on it. Call `read_value` with the project path to see what it is holding.',
  entry: '/app',
  modes: [{ id: 'slides', label: 'Slides', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'What an agent can do with Slides.',
  },
  extensions: { emits: [], consumes: [] },
  reacts: [],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: [],
    /* True because this module keeps material and takes writes: the host then
       frames it on its real origin, so its scripts and `/api` calls are plain
       same-origin requests and nothing needs a permissive CORS header that
       would let any page read the write ticket. See vite.config.ts. */
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
