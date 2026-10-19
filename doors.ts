import { isAbsolute, relative } from 'node:path'

import { DOOR_PROJECT_SAYS, KEHIKOT_DIR, linesOf, resolveSource, type CitationView } from 'kehikot-module-protocol'

import { establishBuild, mintTicket, refuseTicket, type Reply } from 'kehikot-module-protocol/serve'

import { PATHS, type DeckChange, type PointerState, type PresentState } from './deck/api.ts'
import { addCitation } from './deck/cite.ts'
import {
  deckProblems,
  parseDeck,
  parseSlide,
  replaceSlide,
  serialiseSlide,
  slideHeadline,
  slideRanges,
  type Slide,
} from './deck/format.ts'
import { POINTER, POINTER_DID, followPointer, followTalk, heardPointer, moveTalk, pointAt, poke, watchDecks } from './live.ts'
import { resolveFolder, setHostResolve } from './host-ask.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'
import {
  NO_PROJECT,
  badSlug,
  citations,
  citedSlice,
  citedText,
  createDeck,
  deleteDeck,
  history,
  listDecks,
  pictureBytes,
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
 * `stream` opens the server-sent-event doors. `doors()` in `vite.config.ts` is the only
 * thing that touches a socket, which is what lets the tests call these directly.
 */

/**
 * The ticket a page write has to carry.
 *
 * Minted per process and printed into `/app` by `doors()`, so only
 * this app's own page holds it. Loopback is a fence around the machine, not
 * around the programs on it: without this, anything that found the port could
 * write. The page's reads carry it too: every door under `/api/` asks for it, and
 * the streams, which say that something changed and never what, are the only
 * ones that do not. `/mcp` is ungated because an agent has no page to have been
 * handed a ticket by.
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
const AGENT = process.env.SLIDES_AGENT ?? process.env.KEHIKOT_AGENT ?? 'an agent'

/**
 * The project a caller named, as the host has it (protocol 2.3.0, `resolveDoorProject`): the folder to work
 * on, or a sentence saying why not. Every door that reads or writes a project asks here first, and works on
 * the path it gets back, never the one it was handed. A folder that was a project's and is now another's,
 * or nobody's, is refused; one that was renamed is followed to where the project is now, once the host has
 * checked it is the same project. With no host there is nothing to follow and nothing to trust, so it is a
 * refusal: nothing is written under a path the host does not vouch for.
 */
export type ProjectAt = { ok: true; path: string; id: string | null; movedFrom: string | null } | { ok: false; why: string; status: number }

export async function projectAt(value: unknown): Promise<ProjectAt> {
  const named = typeof value === 'string' ? value.trim() : ''
  if (!named) return { ok: false, why: NO_PROJECT, status: 400 }
  const at = await resolveFolder(named)
  if (!at.ok) return { ok: false, why: at.why, status: at.reason === 'unnamed' ? 400 : 404 }
  return { ok: true, path: at.path, id: at.id ?? null, movedFrom: at.movedFrom ?? null }
}

export { setHostResolve }

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
      /* Reads the list and nothing else. */
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: 'The slide decks in a project, most recently changed first. Give epic to see only that epic’s decks.',
      inputSchema: {
        type: 'object',
        properties: { ...PROJECT, epic: { type: 'string', description: 'An epic slug, as list_epics spells it.' } },
        required: ['project'],
      },
    },
    {
      name: 'read_deck',
      /* Reads one file. */
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      /* Writes a new file and never over one: a title already taken is given another slug. */
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      /* Replaces the deck's whole text. What it replaced is kept in the deck's history, with Undo, but it IS gone from the file. */
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
      /* Replaces one slide's text; the history keeps what it was. */
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
      /* Sets one directive on one slide. Nothing of the slide's own text is removed. */
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
      /* Adds a source and its marker. Nothing is removed. */
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    {
      name: 'show_slide',
      description:
        'Turn the Slides page to one slide of a deck, so the person is looking at the slide you are talking about. '
        + 'A pointer, not an edit: nothing is written and nothing goes into the history, the person can turn away '
        + 'by going to another slide themselves, and the next show_slide is followed again. There is nothing to let '
        + 'go of afterwards: the page is not held on the slide. '
        + 'The answer says what happened, as the open pages themselves reported it, in words and in '
        + '`structuredContent`: `outcome` is `shown` only when the slide is on screen in at least one page whose '
        + 'window is not hidden; `unseen` when no Slides page is open on the deck, or none is known to be showing '
        + 'it; `declined` when the open pages would not turn (a talk is being given, or a page holds unsaved text '
        + 'without that slide). A slide outside the parts picked on a page is still brought up there, as the slide '
        + 'in hand, and the answer says so. `index` counts from 0, as read_deck numbers the slides. A slide that is '
        + 'not there is refused with the deck\'s own slide list. '
        + 'Another module, with no MCP call, points by setting the canvas passage on the deck\'s file '
        + `(<project>/${KEHIKOT_DIR}/slides/<deck>.md): a byte range of its Markdown, or \`page\`, the slide's number `
        + 'counting from 1. A passage is state, not an event: the same passage set again after the person has turned '
        + 'away is not followed again, so to point again change the passage or use show_slide.',
      inputSchema: { type: 'object', properties: { ...PROJECT, ...DECK, ...INDEX }, required: ['project', 'deck', 'index'] },
      outputSchema: {
        type: 'object',
        properties: {
          deck: { type: 'string' },
          index: { type: 'integer', description: 'The slide, counting from 0.' },
          slide: { type: 'string', description: 'Its headline, as read_deck prints it.' },
          slides: { type: 'integer', description: 'How many slides the deck has.' },
          outcome: {
            type: 'string',
            enum: [...SHOW_OUTCOMES],
            description:
              'shown: on screen in at least one page whose window is not hidden. unseen: no page is open, or none is '
              + 'known to be showing it. declined: the open pages would not turn.',
          },
          pages: { type: 'integer', description: 'Pages that said the slide is on their screen, in a window that is not hidden.' },
          open: { type: 'integer', description: 'Slides pages open on this deck, presenting or not.' },
          outside: { type: 'integer', description: 'Of `pages`, those where it is outside the picked parts and drawn as the slide in hand.' },
          hidden: { type: 'integer', description: 'Pages that turned to it in a window that is hidden.' },
          stale: { type: 'integer', description: 'Pages not turned: they hold unsaved text without that slide.' },
          presenting: { type: 'integer', description: 'Pages not turned: they are giving a talk.' },
          silent: { type: 'integer', description: 'Pages sent the pointer that did not say what they did in time.' },
          why: { type: 'string', description: 'Why it is not `shown`, in a sentence. Empty when it is.' },
        },
        required: ['deck', 'index', 'slide', 'slides', 'outcome', 'pages', 'open', 'outside', 'hidden', 'stale', 'presenting', 'silent', 'why'],
      },
      /* It turns a page and writes nothing, so a caller that asks a person before running an unmarked tool need not
         ask for this one. Not idempotent: the same call again turns a page the person has since turned away. */
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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

/** The slide show_slide names. Refused with the deck's own slides: the caller is choosing one, not writing one. */
function shownOf(args: Record<string, unknown>, slides: Slide[], slug: string): number {
  const index = typeof args.index === 'string' && args.index.trim() !== '' ? Number(args.index) : args.index
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < slides.length) return index
  throw new Error(
    [
      `"${String(args.index)}" is not a slide of "${slug}": it has ${slides.length} slide${slides.length === 1 ? '' : 's'}, numbered 0 to ${slides.length - 1}, `
        + 'as read_deck numbers them:',
      ...slides.map((slide, i) => `${i}. ${slideHeadline(slide) || '(empty)'}`),
      'Nothing was shown.',
    ].join('\n'),
  )
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

/**
 * A tool call with its project resolved by the host: the tool is handed the path the host gave back, and
 * when that is not the path named, the answer says so — the agent uses the new path from then on.
 */
async function callResolved(name: string, args: Record<string, unknown>): Promise<string> {
  const named = str(args.project, 1000)
  if (!named) return call(name, args)
  const at = await projectAt(named)
  if (!at.ok) throw new Error(at.why)
  const text = call(name, { ...args, project: at.path })
  return at.movedFrom ? `${text}\n\n${DOOR_PROJECT_SAYS.followed(at.movedFrom, at.path)}` : text
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

/** What became of a show_slide. The words kehikko-protocol#28 is settling on for any module's "show this". */
const SHOW_OUTCOMES = ['shown', 'unseen', 'declined'] as const

/**
 * show_slide: point every open page at the slide, wait for each to say what it
 * did, and answer with that. The door cannot see a screen, so it claims a slide
 * is shown only when a page said it is drawing it in a window that is not
 * hidden; a page that said nothing is counted as silent, never as showing.
 */
async function showSlide(args: Record<string, unknown>): Promise<{ text: string; structuredContent: Record<string, unknown> }> {
  const name = 'show_slide'
  const named = projectOf(args, name)
  const at = await projectAt(named)
  if (!at.ok) throw new Error(at.why)
  const project = at.path
  const slug = deckOf(args)
  const root = must(projectRoot(project), name)
  const slides = parseDeck(must(readDeck(project, slug), name).text, slug).slides
  const index = shownOf(args, slides, slug)
  const headline = slideHeadline(slides[index]!)
  const pointing = pointAt(root, slug, index)
  const heard = await pointing.heard

  const on = heard.filter((one) => one.did === 'shown' || one.did === 'outside')
  const seen = on.filter((one) => !one.hidden)
  const count = {
    pages: seen.length,
    open: pointing.watching + pointing.presenting,
    outside: seen.filter((one) => one.did === 'outside').length,
    hidden: on.length - seen.length,
    stale: heard.filter((one) => one.did === 'stale').length,
    presenting: pointing.presenting + heard.filter((one) => one.did === 'presenting').length,
    silent: pointing.watching - heard.length,
  }
  const outcome: (typeof SHOW_OUTCOMES)[number] = count.pages ? 'shown' : !count.open || count.hidden || count.silent ? 'unseen' : 'declined'

  const which = `slide ${index} of "${slug}" (${headline || 'empty'}; ${slides.length} in the deck)`
  const pages = (n: number) => (n === 1 ? 'one open Slides page' : `${n} open Slides pages`)
  const one = (n: number, single: string, several: string) => (n === 1 ? single : `${n} ${several}`)
  /* Each thing that kept a page from showing it, as a sentence. In the order a caller can do something about. */
  const kept = [
    count.hidden ? `${one(count.hidden, 'One page turned to it in a window that is hidden', 'pages turned to it in windows that are hidden')}, where nobody is looking.` : '',
    count.silent
      ? `${one(count.silent, 'One page was sent the pointer and did not say', 'pages were sent the pointer and did not say')} within ${POINTER.waitMs} ms what `
        + `${count.silent === 1 ? 'it' : 'they'} did, so whether ${count.silent === 1 ? 'it' : 'they'} turned is not known.`
      : '',
    count.stale ? `${one(count.stale, 'One page was not turned: it holds', 'pages were not turned: they hold')} text that is not saved and has no slide ${index} in it.` : '',
    count.presenting ? `${one(count.presenting, 'One page is presenting and was', 'pages are presenting and were')} not turned: a talk is not turned from outside.` : '',
  ].filter(Boolean)

  let text: string
  if (!count.open) {
    text = `No Slides page is open on "${slug}", so nobody was shown ${which}. Nothing was turned and nothing was written. `
      + 'Once the deck is open on the canvas, call show_slide again.'
  } else if (outcome === 'shown') {
    const where = count.outside
      ? count.pages === 1
        ? ' It is outside the parts picked on that page, so it is drawn there as the slide in hand, until the person turns to another slide.'
        : ` On ${count.outside} of them it is outside the picked parts, and is drawn there as the slide in hand, until the person turns to another slide.`
      : ''
    text = `${which[0]!.toUpperCase()}${which.slice(1)} is on screen in ${pages(count.pages)} on this deck.${where}`
      + `${kept.length ? ` ${kept.join(' ')}` : ''} Nothing was written; the person can turn away, and the next show_slide is followed again.`
  } else {
    text = `Nobody is known to be looking at ${which}: ${pages(count.open)} on this deck, and none is showing it where it can be seen. `
      + `${kept.join(' ')} Nothing was written.`
      + (count.presenting && count.presenting === count.open ? ' Call show_slide again once the talk is over.' : '')
  }
  const why = outcome === 'shown' ? '' : count.open ? kept.join(' ') : `No Slides page is open on "${slug}".`
  if (at.movedFrom) text += `\n\n${DOOR_PROJECT_SAYS.followed(at.movedFrom, at.path)}`
  return { text, structuredContent: { deck: slug, index, slide: headline, slides: slides.length, outcome, ...count, why } }
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply | Promise<Reply> {
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
  if (rpc.method === 'tools/call' && rpc.params?.name === 'show_slide') {
    /* The one tool that waits: for the pages it pointed to say what they did. A refusal is an answer here too. */
    return (async () => showSlide(rpc.params?.arguments ?? {}))().then(
      (shown) => reply({ content: [{ type: 'text', text: shown.text }], structuredContent: shown.structuredContent }),
      (e: unknown) => text(e instanceof Error ? e.message : String(e), true),
    )
  }
  if (rpc.method === 'tools/call') {
    try {
      return callResolved(String(rpc.params?.name ?? ''), rpc.params?.arguments ?? {}).then(
        (said) => text(said),
        /* A refusal is an answer the agent reads, not a transport failure it retries. */
        (e: unknown) => text(e instanceof Error ? e.message : String(e), true),
      )
    } catch (e) {
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }
  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** The doors under /api/ that are about one project, besides the picture (which is asked the same way). */
const PROJECT_DOORS = new Set<string>([PATHS.decks, PATHS.deck, PATHS.history, PATHS.undo, PATHS.citations, PATHS.source, PATHS.present, PATHS.pointer])

/** What rides with every picture. `style-src` lets an SVG's own `<style>` colour it; nothing in it can load or run. */
export const PICTURE_HEADERS: Record<string, string> = {
  'cache-control': 'private, max-age=60',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
  /* An `<img>` takes no notice of this; an address opened on its own is saved rather than shown. */
  'content-disposition': 'attachment',
}

function done<T>(result: Result<T>, shape: (value: T) => Record<string, unknown>): Reply {
  return result.ok ? ok(shape(result.value)) : refused(result)
}

function field(body: Record<string, unknown> | null, name: string): string {
  return body && typeof body[name] === 'string' ? (body[name] as string) : ''
}

export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Promise<Reply | null> {
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

  /*
   * A picture a slide names, from the project: the one door here that answers with a file's bytes.
   *
   * Behind the ticket though it is a read, because it hands out what is on the disk rather than
   * what this module keeps. An `<img>` cannot carry a header, so the ticket rides in the address,
   * as the page that drew the slide printed it. Everything `pictureBytes` refuses is one 404:
   * an answer that told them apart would report what is on this disk.
   *
   * The headers are for the bytes being opened on their own rather than in an `<img>`: an SVG is
   * a document and would run script on this origin, so it is sandboxed with nothing to load,
   * never sniffed into another type, and not embeddable by a page on another origin. Kept by the
   * browser for a minute, privately, so turning a slide does not fetch its figure again.
   */
  if (path === PATHS.asset) {
    if (method !== 'GET') return bad('A picture is only read.', 405)
    const refused = refuseTicket(query.get('ticket') ?? ticket, TICKET, 'That picture was not asked for by this app’s own page.')
    if (refused) return refused
    const where = await projectAt(query.get('project'))
    const picture = where.ok ? pictureBytes(where.path, query.get('path') ?? '') : null
    if (!picture) return bad('There is no such picture in this project.', 404)
    return { status: 200, body: null, raw: picture, headers: PICTURE_HEADERS }
  }

  /*
   * Every other door under /api/ asks for the page's ticket, the reads with the writes: a read
   * here answers with what is in a project, and this app's own page is the only caller it has.
   * Marked as a ticket refusal, so a page older than this server knows to reload itself.
   */
  const stranger = refuseTicket(
    ticket,
    TICKET,
    WRITES.has(method) ? 'That press did not come from this app’s own page.' : 'That was not asked by this app’s own page.',
  )
  if (stranger) return stranger
  if (WRITES.has(method) && !body) return bad('That was not a request: a write sends a JSON object.')
  const named = method === 'GET' ? query.get('project') : field(body, 'project')
  const slug = method === 'GET' ? (query.get('slug') ?? '') : field(body, 'slug')

  /*
   * Where a project is now, for a window of its own that was opened on a path and a project id: the
   * presenter and the print view carry both in their address, because no host is there to say them.
   * A folder renamed since is followed; a folder that is now another project is refused, so the window
   * never shows a deck of a project it was not opened on.
   */
  if (path === PATHS.where && method === 'GET') {
    const there = await projectAt(named)
    if (!there.ok) return bad(there.why, there.status)
    const opened = query.get('projectId')
    if (opened && there.id && opened !== there.id) return bad(DOOR_PROJECT_SAYS.notProject(named ?? ''), 404)
    return ok({ project: there.path, id: there.id, movedFrom: there.movedFrom })
  }

  /* Every other door under /api/ works on a project, and works on the path the host gives back. */
  if (!PROJECT_DOORS.has(path)) return bad('There is nothing here.', 404)
  const at = await projectAt(named)
  if (!at.ok) return bad(at.why, at.status)
  const project = at.path
  const after = (reply: Reply): Reply => {
    if (reply.status === 200) poke(project)
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

  /* A page saying what it did with a pointing. Nothing is kept: it is handed to the show_slide waiting for it. */
  if (path === PATHS.pointer && method === 'POST') {
    const root = projectRoot(project)
    if (!root.ok) return refused(root)
    const why = badSlug(slug)
    if (why) return bad(why)
    const did = POINTER_DID.find((one) => one === body?.did)
    if (typeof body?.at !== 'number' || !did) return bad(`A page says which pointing (at) and what it did with it: ${POINTER_DID.join(', ')}.`)
    return ok({ heard: heardPointer(root.value, slug, body.at, { did, hidden: body.hidden === true }) })
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
  emit: (event: DeckChange | PresentState | PointerState) => void,
): { reply: Reply } | { close: () => void } | null {
  if (method !== 'GET') return null
  if (path !== PATHS.watch && path !== PATHS.present && path !== PATHS.pointer) return null
  const slug = query.get('slug') ?? ''
  if (path !== PATHS.watch) {
    const why = badSlug(slug)
    if (why) return { reply: bad(why) }
  }
  /*
   * The project is the host's to vouch for here too, and asking takes a moment, so the stream is opened
   * at once and attached when the host has answered: to the path it gave back. A folder the host does not
   * vouch for is never watched or followed, and the stream stays quiet. What is followed is kept by the
   * project's key (`live.ts`), so a stream opened before a rename keeps its talk.
   */
  let close = (): void => {}
  let gone = false
  void projectAt(query.get('project')).then((at) => {
    if (gone || !at.ok) return
    if (path === PATHS.watch) {
      const watched = watchDecks(at.path, emit)
      if (watched.ok) close = watched.value
      return
    }
    const root = projectRoot(at.path)
    if (!root.ok) return
    close = path === PATHS.present ? followTalk(root.value, slug, emit) : followPointer(root.value, slug, emit, query.get('presenting') === '1')
    if (gone) close()
  })
  return {
    close: () => {
      gone = true
      close()
    },
  }
}

export { MANIFEST }
