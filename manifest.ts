import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'

export const ID = 'kehikot.slides'
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
  /* Where a host files this module in its list, most fitting first. */
  tags: ['writing'],
  summary: 'Presentation decks for a paper: Markdown slides that follow the paper as you read and present.',
  /* What this module's PRESENCE obliges an agent to do. Composed into every
     agent's prompt on the canvas, so write it to somebody who just arrived. */
  guidance:
    'This canvas has Slides on it: presentation decks kept as Markdown files in the project, at '
    + '.kehikot/slides/<deck>.md. Slides linked to a paper section follow the paper as it is read, and turn the '
    + 'paper when shown. `list_decks` and `read_deck` show what exists; read a deck before changing it. To draft a '
    + 'talk, use the paper module’s `list_sections` and `read_paper`, then `create_deck` and `write_deck` with one or '
    + 'more slides per section and speaker notes after a `Notes:` line, and `link_slide` each slide to its section. '
    + '`edit_slide` changes one slide. Every write is kept in the deck’s history and the person can undo it, so give '
    + 'a one-line `summary` and your name as `agent`. Do not edit the .md files directly while the person is editing.',
  entry: '/app',
  modes: [{ id: 'slides', label: 'Slides', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about:
      'Read, draft and edit presentation decks (Markdown slides) for a project, and link slides to paper sections. '
      + 'Every write is recorded so the person can undo it.',
  },
  extensions: { emits: [], consumes: [] },
  /* A description, not a request: the deck moves to the slides for the section
     the paper is on — what the host draws as "follows a passage". */
  reacts: ['passage'],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['epics:read', 'passage:set', 'showing:set', 'state:keep'],
    /* True because this module keeps material and takes writes: the host then
       frames it on its real origin, so its scripts and `/api` calls are plain
       same-origin requests and nothing needs a permissive CORS header that
       would let any page read the write ticket. See vite.config.ts. */
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
