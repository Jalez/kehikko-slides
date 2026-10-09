import { isAbsolute, relative } from 'node:path'

import { KEHIKOT_DIR, linesOf, resolveSource, type CitationView } from 'kehikot-module-protocol'

import { establishBuild, mintTicket, refuseTicket, type Reply } from 'kehikot-module-protocol/serve'

import { PATHS, type DeckChange, type PresentState } from './deck/api.ts'
import { addCitation } from './deck/cite.ts'
import {
  deckProblems,
  parseDeck,
  parseSlide,
  replaceSlide,
  serialiseSlide,
  slideHeadline,
  slideRanges,
} from './deck/format.ts'
import { followTalk, moveTalk, poke, watchDecks } from './live.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'
import {
  badSlug,
  citations,
  citedSlice,
  citedText,
  createDeck,
  deleteDeck,
  history,
  listDecks,
  projectRoot,
  readDeck,
  record,
  recordedWrite,
  retitleDeck,
  undo,
  writeDeck,
  type Failure,
  type Result,
} from './store.ts'

/**
 * Every door but the page, as pure functions: `answer` takes a request and
 * returns a status and a body, or `null` for "not ours, let Vite have it";
 * `stream` opens the two server-sent-event doors. `doors()` in `vite.config.ts` is the only
 * thing that touches a socket, which is what lets the tests call these directly.
 */

/**
 * The ticket a page write has to carry.
 *
 * Minted per process and printed into `/app` by `doors()`, so only
 * this app's own page holds it. Loopback is a fence around the machine, not
 * around the programs on it: without this, anything that found the port could
 * write. Reads are ungated, and `/mcp` is ungated because an agent has no page
 * to have been handed a ticket by.
 */
export const TICKET = mintTicket()

/** What this process is built from and when it started; `doors()` says it wherever a build is said. */
export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

export type { Reply }


const ok = (body: Record<string, unknown> = {}): Reply => ({ status: 200, body: { ok: true, ...body } })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })
const refused = (failure: Failure): Reply =>
  failure.status === 409
    ? { status: 409, body: { ok: false, error: failure.error, version: failure.version ?? null, text: failure.text ?? null } }
    : bad(failure.error, failure.status ?? 400)

/** What an agent is called when it does not say. */
const AGENT = process.env.SLIDES_AGENT ?? process.env.KEHIKOT_AGENT ?? process.env.ROADMAP_AGENT ?? 'an agent'

/* ------------------------------------------------------------------ *
 * The MCP door, for agents.
 * ------------------------------------------------------------------ */

const PROJECT = {
  project: {
    type: 'string',
    description:
      'The absolute directory of the project — the folder the canvas is standing in. Decks are kept inside it, at '
      + `<project>/${KEHIKOT_DIR}/slides/<deck>.md, so this is where the file is, not a label.`,
  },
} as const

const DECK = { deck: { type: 'string', description: 'The deck’s slug, as list_decks prints it (its file name without .md).' } } as const
const AGENT_ARG = { agent: { type: 'string', description: 'Your own name, so the history says who made the change.' } } as const
const SUMMARY = {
  summary: { type: 'string', description: 'One line saying what you changed and why. Shown beside the Undo button.' },
} as const
const INDEX = { index: { type: 'integer', description: 'Which slide, counting from 0, as read_deck numbers them.' } } as const

const FORMAT =
  'A deck is one Markdown file. Front matter (title, epic, aspect) between --- lines, then slides separated by a line '
  + 'that is exactly ---. A slide may open with one directive comment, e.g. <!-- layout: two-column; section: '
  + 'chapters/2.tex | Bridging the gap -->; layouts are title, bullets (default), two-column (split on a ||| line), '
  + 'image, quote. A line that is exactly Sources: (before Notes:) opens the slide\'s citations, one per line: '
  + '[^1]: <project-relative path> | "<the exact words in that file>", and [^1] in the body marks what rests on it '
  + '(cite_slide writes both for you). Everything after a line that is exactly Notes: is speaker notes.'

function tools() {
  return [
    {
      name: 'list_decks',
      description: 'The slide decks in a project, most recently changed first. Give epic to see only that epic’s decks.',
      inputSchema: {
        type: 'object',
        properties: { ...PROJECT, epic: { type: 'string', description: 'An epic slug, as list_epics spells it.' } },
        required: ['project'],
      },
    },
    {
      name: 'read_deck',
      description:
        'One deck: a numbered list of its slides (layout, headline, linked paper section, whether it has notes), '
        + 'each slide\'s citations with the lines of the file they were found on and whether they still hold, '
        + 'then its whole Markdown. Read it before editing; the numbers are what edit_slide, link_slide and cite_slide take. '
        + 'A citation marked ADRIFT cites words its file no longer has: the paper changed under the slide, so check '
        + 'the slide\'s claim against the paper before fixing the quote.',
      inputSchema: { type: 'object', properties: { ...PROJECT, ...DECK }, required: ['project', 'deck'] },
    },
    {
      name: 'create_deck',
      description:
        'Start a deck with one title slide. Its slug is made from the title. To draft a talk from a paper: call the '
        + 'paper module’s list_sections and read_paper, create the deck, write it with write_deck (one or more slides '
        + 'per section, speaker notes after a Notes: line), then link each slide to its section with link_slide.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT,
          title: { type: 'string', description: 'The deck’s title.' },
          epic: { type: 'string', description: 'The epic this talk belongs to, as list_epics spells it. Optional.' },
          ...AGENT_ARG,
        },
        required: ['project', 'title'],
      },
    },
    {
      name: 'write_deck',
      description:
        `Replace a whole deck's Markdown. ${FORMAT} The previous text is kept, so the person can undo your write. `
        + 'Use edit_slide to change one slide.',
      inputSchema: {
        type: 'object',
        properties: { ...PROJECT, ...DECK, markdown: { type: 'string', description: 'The whole deck.' }, ...SUMMARY, ...AGENT_ARG },
        required: ['project', 'deck', 'markdown', 'summary'],
      },
    },
    {
      name: 'edit_slide',
      description:
        'Replace one slide, leaving every other byte of the deck as it was. markdown is that one slide: its '
        + 'directive comment (if any), its body, and its notes after a Notes: line — but no --- line; use write_deck '
        + 'to add or remove slides. Recorded in the history, so the person can undo it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT,
          ...DECK,
          ...INDEX,
          markdown: { type: 'string', description: 'The slide’s new text.' },
          ...SUMMARY,
          ...AGENT_ARG,
        },
        required: ['project', 'deck', 'index', 'markdown', 'summary'],
      },
    },
    {
      name: 'link_slide',
      description:
        'Link a slide to a section of the paper, so the slides follow the paper as it is read and the paper turns '
        + 'to that section when the slide is shown. path and title are a section exactly as the paper module’s '
        + 'list_sections gives them: the file relative to the project, and the heading’s text.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT,
          ...DECK,
          ...INDEX,
          path: { type: 'string', description: 'The section’s file, relative to the project (e.g. chapters/2_bridge.tex).' },
          title: { type: 'string', description: 'The section heading, exactly as the paper spells it.' },
          ...AGENT_ARG,
        },
        required: ['project', 'deck', 'index', 'path', 'title'],
      },
    },
    {
      name: 'cite_slide',
      description:
        'Say exactly which words of a file a claim on a slide rests on. Adds [^n] after the slide words you name in '
        + 'at (or nowhere, citing the slide as a whole, when at is left out) and a source line under the slide\'s '
        + 'Sources:. quote must be the file\'s own words — the .tex source as the paper module\'s read_source shows '
        + 'it, markup and all; line breaks and runs of spaces need not match. It is refused unless the words are in '
        + 'the file exactly once, so a citation cannot be written that already points nowhere. Citing the same words '
        + 'twice on a slide reuses their number. Recorded in the history, so the person can undo it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT,
          ...DECK,
          ...INDEX,
          path: { type: 'string', description: 'The cited file, relative to the project (e.g. chapters/4_results.tex).' },
          quote: { type: 'string', description: 'The exact words in that file the claim rests on: a sentence or two, enough to occur once.' },
          at: {
            type: 'string',
            description: 'Words on the slide, exactly as its body has them and occurring once, that the marker goes right after (e.g. "3.51"). Leave out to cite the slide as a whole.',
          },
          ...AGENT_ARG,
        },
        required: ['project', 'deck', 'index', 'path', 'quote'],
      },
    },
  ]
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function projectOf(args: Record<string, unknown>, tool: string): string {
  const project = str(args.project, 1000)
  if (!project) {
    throw new Error(
      `${tool} needs project: the absolute directory of the project. Decks are kept inside it, at `
        + `<project>/${KEHIKOT_DIR}/slides/, and there is no default that would be right. Nothing was done.`,
    )
  }
  return project
}

function deckOf(args: Record<string, unknown>): string {
  const deck = typeof args.deck === 'string' ? args.deck.trim() : ''
  const why = badSlug(deck)
  if (why) throw new Error(`${why} list_decks prints the slugs.`)
  return deck
}

function must<T>(result: { ok: true; value: T } | Failure, tool: string): T {
  if (!result.ok) {
    throw new Error(result.status === 404 && /no deck/.test(result.error) ? `${result.error} list_decks shows the decks there are; create_deck starts one.` : result.error)
  }
  return result.value
}

function indexOf(args: Record<string, unknown>, count: number, slug: string): number {
  const index = typeof args.index === 'string' && args.index.trim() !== '' ? Number(args.index) : args.index
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(
      `"${String(args.index)}" is not a slide of "${slug}": it has ${count} slide${count === 1 ? '' : 's'}, numbered 0 to ${count - 1}. `
        + 'read_deck shows them. Nothing was written.',
    )
  }
  return index
}

function by(args: Record<string, unknown>, summary: string) {
  return { agent: str(args.agent, 80) || AGENT, summary }
}

function summaryOf(args: Record<string, unknown>, tool: string): string {
  const summary = str(args.summary, 300)
  if (!summary) throw new Error(`${tool} needs a summary: one line saying what you changed. The person sees it beside Undo. Nothing was written.`)
  return summary
}

function checked(text: string): void {
  const problems = deckProblems(text)
  if (problems.length) throw new Error(`${problems.join(' ')} Nothing was written.`)
}

/** One citation as read_deck lists it. */
function citationLine(one: CitationView): string {
  const where = one.at ? `${one.path} ${linesOf(one.at)}` : one.path
  const said = one.quote.length > 90 ? `${one.quote.slice(0, 87)}…` : one.quote
  if (one.status === 'holds') return `     [^${one.label}] ${where}: "${said}"`
  if (one.status === 'ambiguous') return `     [^${one.label}] ${where} — AMBIGUOUS, the words occur ${one.count} times; quote more: "${said}"`
  if (one.status === 'adrift') return `     [^${one.label}] ${one.path} — ADRIFT, these words are no longer in the file: "${said}"`
  return `     [^${one.label}] ${one.path} — UNREADABLE, no such file inside the project: "${said}"`
}

function readDeckText(project: string, slug: string): string {
  const deck = must(readDeck(project, slug), 'read_deck')
  const parsed = parseDeck(deck.text, slug)
  const cited = citations(project, slug)
  const found = cited.ok ? cited.value : []
  const lines = parsed.slides.flatMap((slide, i) => {
    const parts = [`${i}. ${slide.layout}`, slideHeadline(slide) || '(empty)']
    if (slide.section) parts.push(`section: ${slide.section.path} | ${slide.section.title}`)
    if (slide.notes) parts.push('has notes')
    return [parts.join(' — '), ...(found[i] ?? []).map(citationLine)]
  })
  const all = found.flat()
  const broken = all.filter((one) => one.status !== 'holds').length
  const tally = all.length
    ? `${all.length} citation${all.length === 1 ? '' : 's'}${broken ? `, ${broken} not holding (see below)` : ', all holding'}.`
    : 'No citations yet: cite_slide adds them.'
  return [
    `"${parsed.title}" (${slug})${parsed.epic ? `, epic ${parsed.epic}` : ''}, ${parsed.aspect}, ${parsed.slides.length} slide${parsed.slides.length === 1 ? '' : 's'}. ${tally}`,
    '',
    'Slides (index. layout — headline — section; then each citation, with the lines it was found on):',
    ...lines,
    '',
    'Markdown:',
    deck.text,
  ].join('\n')
}

/** A section path as it is written into a deck: relative to the project, inside it. */
function sectionPath(project: string, raw: string): string {
  const root = must(projectRoot(project), 'link_slide')
  let path = raw.replace(/\\/g, '/')
  /* Either spelling of the project: as it was given, or its realpath (/tmp and /private/tmp). */
  if (isAbsolute(path)) path = [relative(root, path), relative(project, path)].find((one) => !one.startsWith('..')) ?? '..'
  path = path.replace(/^\.\//, '')
  if (!path || path.startsWith('..') || isAbsolute(path)) {
    throw new Error(`"${raw}" is not a file inside this project. Give the path list_sections gives, relative to the project. Nothing was written.`)
  }
  return path
}

function directiveSafe(what: string, value: string): void {
  if (/[|;\n]|-->/.test(value)) {
    throw new Error(`The section ${what} "${value}" contains | ; or -->, which a slide's directive comment cannot hold. Nothing was written.`)
  }
}

function call(name: string, args: Record<string, unknown>): string {
  if (name === 'list_decks') {
    const project = projectOf(args, name)
    const epic = str(args.epic, 80)
    const decks = must(listDecks(project), name).filter((one) => !epic || one.epic === epic)
    if (!decks.length) {
      return epic ? `No deck in ${project} belongs to the epic "${epic}". create_deck starts one.` : `There are no decks in ${project} yet. create_deck starts one.`
    }
    return decks
      .map(
        (one) =>
          `- ${one.slug}: "${one.title}"${one.epic ? `, epic ${one.epic}` : ''}, ${one.slides} slide${one.slides === 1 ? '' : 's'}, `
          + `changed ${new Date(one.updated).toISOString()}`,
      )
      .join('\n')
  }

  if (name === 'read_deck') return readDeckText(projectOf(args, name), deckOf(args))

  if (name === 'create_deck') {
    const project = projectOf(args, name)
    const made = must(createDeck(project, str(args.title, 400), str(args.epic, 100) || null), name)
    record(project, made.slug, null, by(args, `created the deck "${str(args.title, 200)}"`))
    poke(project)
    return `Created "${made.slug}" with one title slide. write_deck fills it; read_deck shows it.`
  }

  if (name === 'write_deck') {
    const project = projectOf(args, name)
    const slug = deckOf(args)
    const summary = summaryOf(args, name)
    const markdown = typeof args.markdown === 'string' ? args.markdown : ''
    if (!markdown.trim()) throw new Error('write_deck needs markdown: the whole deck. To remove a deck, ask the person. Nothing was written.')
    must(readDeck(project, slug), name)
    checked(markdown)
    must(recordedWrite(project, slug, markdown, by(args, summary)), name)
    poke(project)
    const count = parseDeck(markdown).slides.length
    return `Wrote "${slug}": ${count} slide${count === 1 ? '' : 's'}. The person can undo it from History.`
  }

  if (name === 'edit_slide' || name === 'link_slide') {
    const project = projectOf(args, name)
    const slug = deckOf(args)
    const text = must(readDeck(project, slug), name).text
    const ranges = slideRanges(text.replace(/\r\n/g, '\n'))
    const index = indexOf(args, ranges.length, slug)
    let slide: string
    let summary: string
    if (name === 'edit_slide') {
      summary = summaryOf(args, name)
      slide = typeof args.markdown === 'string' ? args.markdown : ''
      if (slide.split('\n').some((line) => /^---[ \t]*$/.test(line))) {
        throw new Error('edit_slide takes one slide, and that markdown has a --- line in it, which would split it in two. Use write_deck to add slides. Nothing was written.')
      }
    } else {
      const path = sectionPath(project, str(args.path, 1000))
      const title = str(args.title, 300)
      if (!title) throw new Error('link_slide needs title: the section heading, as list_sections gives it. Nothing was written.')
      directiveSafe('path', path)
      directiveSafe('title', title)
      const range = ranges[index]!
      const parsed = parseSlide(text.replace(/\r\n/g, '\n').slice(range.from, range.to))
      slide = serialiseSlide({ ...parsed, section: { path, title } })
      summary = `linked slide ${index} to "${title}"`
    }
    const next = replaceSlide(text, index, slide)
    if (next === null) throw new Error(`There is no slide ${index} in "${slug}". Nothing was written.`)
    checked(next)
    if (slideRanges(next).length !== ranges.length) {
      throw new Error('That would change how many slides the deck has. Use write_deck for that. Nothing was written.')
    }
    must(recordedWrite(project, slug, next, by(args, summary)), name)
    poke(project)
    return name === 'edit_slide' ? `Replaced slide ${index} of "${slug}".` : `Slide ${index} of "${slug}" now follows "${str(args.title, 300)}".`
  }

  if (name === 'cite_slide') {
    const project = projectOf(args, name)
    const slug = deckOf(args)
    const root = must(projectRoot(project), name)
    const text = must(readDeck(project, slug), name).text
    const index = indexOf(args, slideRanges(text.replace(/\r\n/g, '\n')).length, slug)
    const path = sectionPath(project, str(args.path, 1000))
    const quote = typeof args.quote === 'string' ? args.quote : ''
    const file = citedText(root, path)
    if (file === null) throw new Error(`"${path}" is not a readable file inside this project. Give the path relative to the project, as list_sections gives it. Nothing was written.`)
    const found = resolveSource({ label: '', path, quote }, file)
    if (found.status === 'adrift') {
      throw new Error(`Those words are not in ${path}. Quote the file's own text, as read_source shows it (LaTeX markup included); only whitespace may differ. Nothing was written.`)
    }
    if (found.status === 'ambiguous') throw new Error(`Those words occur ${found.count} times in ${path}. Quote more of the sentence so they occur once. Nothing was written.`)
    const at = typeof args.at === 'string' && args.at.length ? args.at : null
    const done = addCitation(text, index, { path, quote }, at ? { after: at } : { whole: true })
    if ('error' in done) throw new Error(`${done.error} Nothing was written.`)
    checked(done.text)
    must(recordedWrite(project, slug, done.text, by(args, `cited ${path} ${linesOf(found.at!)} on slide ${index}`)), name)
    poke(project)
    return `Slide ${index} of "${slug}" now cites ${path} ${linesOf(found.at!)} as [^${done.label}]${at ? `, after "${at.slice(0, 60)}"` : ', for the slide as a whole'}.`
  }

  throw new Error(`There is no tool "${name.slice(0, 60)}" here.`)
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ({ status: 200, body: { jsonrpc: '2.0', id: rpc.id ?? null, result } })
  const text = (s: string, isError = false) => reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions: MANIFEST.mcp?.about ?? '',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return { status: 202, body: null }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })
  if (rpc.method === 'tools/call') {
    try {
      return text(call(String(rpc.params?.name ?? ''), rpc.params?.arguments ?? {}))
    } catch (e) {
      /* A refusal is an answer the agent reads, not a transport failure it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }
  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function done<T>(result: Result<T>, shape: (value: T) => Record<string, unknown>): Reply {
  return result.ok ? ok(shape(result.value)) : refused(result)
}

function field(body: Record<string, unknown> | null, name: string): string {
  return body && typeof body[name] === 'string' ? (body[name] as string) : ''
}

export function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Reply | null {
  if (path === '/healthz') {
    return ok({ id: ID, version: VERSION, where: `<project>/${KEHIKOT_DIR}/slides/<deck>.md` })
  }

  if (path === '/mcp') {
    if (method !== 'POST') return bad('The MCP door takes POST.', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  if (!path.startsWith('/api/')) return null

  if (WRITES.has(method)) {
    /* Marked as a ticket refusal, so a page older than this server knows to reload itself. */
    const refused = refuseTicket(ticket, TICKET, 'That press did not come from this app’s own page.')
    if (refused) return refused
    if (!body) return bad('That was not a request: a write sends a JSON object.')
  }
  const project = method === 'GET' ? query.get('project') : field(body, 'project')
  const slug = method === 'GET' ? (query.get('slug') ?? '') : field(body, 'slug')
  const after = (reply: Reply): Reply => {
    if (reply.status === 200 && project) poke(project)
    return reply
  }

  if (path === PATHS.decks && method === 'GET') return done(listDecks(project), (decks) => ({ decks }))
  if (path === PATHS.decks && method === 'POST') {
    return after(done(createDeck(project, field(body, 'title'), field(body, 'epic') || null), (made) => ({
      slug: made.slug,
      version: made.version,
    })))
  }

  if (path === PATHS.deck && method === 'GET') return done(readDeck(project, slug), (deck) => ({ ...deck }))
  if (path === PATHS.deck && method === 'PUT') {
    if (typeof body?.text !== 'string') return bad('A save sends text: the whole deck.')
    const base = typeof body.base === 'string' ? body.base : null
    return after(done(writeDeck(project, slug, body.text, base), (saved) => ({ version: saved.version })))
  }
  if (path === PATHS.deck && method === 'PATCH') {
    return after(done(retitleDeck(project, slug, field(body, 'title')), (saved) => ({ version: saved.version })))
  }
  if (path === PATHS.deck && method === 'DELETE') return after(done(deleteDeck(project, slug), () => ({})))

  if (path === PATHS.history && method === 'GET') return done(history(project, slug), (entries) => ({ entries }))
  if (path === PATHS.undo && method === 'POST') {
    return after(done(undo(project, slug, field(body, 'id')), (undone) => ({ version: undone.version })))
  }

  if (path === PATHS.citations && method === 'GET') return done(citations(project, slug), (slides) => ({ slides }))
  if (path === PATHS.source && method === 'GET') {
    const number = (name: string) => Number(query.get(name) ?? NaN)
    return done(citedSlice(project, query.get('path') ?? '', number('from'), number('to')), (text) => ({ text }))
  }

  if (path === PATHS.present && method === 'POST') {
    const root = projectRoot(project)
    if (!root.ok) return refused(root)
    const why = badSlug(slug)
    if (why) return bad(why)
    const index = body?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return bad('index is a slide number counting from 0.')
    return ok({ state: moveTalk(root.value, slug, index, body?.blank === true) })
  }

  /* An unknown path under /api/ is ours to refuse, not Vite's to serve as a file. */
  return bad('There is nothing here.', 404)
}

/**
 * The server-sent-event doors. `emit` is handed each event as it happens;
 * the answer is either a refusal to send instead of opening the stream, or
 * the function to call when the client goes away. `null`: not a stream door.
 */
export function stream(
  method: string,
  path: string,
  query: URLSearchParams,
  emit: (event: DeckChange | PresentState) => void,
): { reply: Reply } | { close: () => void } | null {
  if (method !== 'GET') return null
  if (path === PATHS.watch) {
    const watched = watchDecks(query.get('project') ?? '', emit)
    return watched.ok ? { close: watched.value } : { reply: refused(watched) }
  }
  if (path === PATHS.present) {
    const root = projectRoot(query.get('project'))
    if (!root.ok) return { reply: refused(root) }
    const slug = query.get('slug') ?? ''
    const why = badSlug(slug)
    if (why) return { reply: bad(why) }
    return { close: followTalk(root.value, slug, emit) }
  }
  return null
}

export { MANIFEST }
