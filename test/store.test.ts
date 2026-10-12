import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDeck } from '../deck/format.ts'
import {
  citedSlice,
  citedText,
  createDeck,
  deleteDeck,
  history,
  MAX_PICTURE_BYTES,
  listDecks,
  pictureBytes,
  readDeck,
  record,
  recordedWrite,
  retitleDeck,
  undo,
  writeDeck,
} from '../store.ts'

const home = mkdtempSync(join(tmpdir(), 'kehikko-slides-store-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))

function project(name: string): string {
  const dir = join(home, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe('decks', () => {
  test('a new deck is one title slide in a file inside the project, and reads back', () => {
    const dir = project('round-trip')
    expect(must(listDecks(dir))).toEqual([])
    const made = must(createDeck(dir, 'My Defence', 'my-thesis'))
    expect(made.slug).toBe('my-defence')
    expect(existsSync(join(dir, '.kehikot', 'slides', 'my-defence.md'))).toBe(true)
    const deck = parseDeck(must(readDeck(dir, 'my-defence')).text)
    expect(deck).toMatchObject({ title: 'My Defence', epic: 'my-thesis' })
    expect(deck.slides.map((one) => one.layout)).toEqual(['title'])

    const version = must(writeDeck(dir, 'my-defence', '---\ntitle: X\n---\n\n# a\n\n---\n\n# b\n')).version
    const read = must(readDeck(dir, 'my-defence'))
    expect(read.version).toBe(version)
    expect(read.text).toContain('# b')
    expect(must(listDecks(dir))).toMatchObject([{ slug: 'my-defence', title: 'X', epic: null, slides: 2 }])
  })

  test('the list is most recently changed first', () => {
    const dir = project('order')
    must(createDeck(dir, 'Old'))
    must(createDeck(dir, 'New'))
    utimesSync(join(dir, '.kehikot', 'slides', 'old.md'), new Date(1000), new Date(1000))
    expect(must(listDecks(dir)).map((one) => one.slug)).toEqual(['new', 'old'])
  })

  test('slugs are unique: a taken one gets -2, -3', () => {
    const dir = project('unique')
    expect(must(createDeck(dir, 'Talk')).slug).toBe('talk')
    expect(must(createDeck(dir, 'Talk')).slug).toBe('talk-2')
    expect(must(createDeck(dir, 'talk!')).slug).toBe('talk-3')
  })

  test('a save on a stale base is a conflict carrying what is there now', () => {
    const dir = project('conflict')
    const made = must(createDeck(dir, 'Deck'))
    const first = must(writeDeck(dir, 'deck', '# one\n', made.version)).version
    const stale = writeDeck(dir, 'deck', '# two\n', made.version)
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.status).toBe(409)
    expect(stale.version).toBe(first)
    expect(stale.text).toBe('# one\n')
    expect(must(readDeck(dir, 'deck')).text).toBe('# one\n')
  })

  test('saving a deck that does not exist is refused', () => {
    const dir = project('missing')
    const written = writeDeck(dir, 'nope', '# x\n')
    expect(written).toMatchObject({ ok: false, status: 404 })
  })

  test('retitle keeps the slug and the slides', () => {
    const dir = project('retitle')
    must(createDeck(dir, 'First'))
    must(writeDeck(dir, 'first', '---\ntitle: First\n---\n\n# a\n\n---\n\n# b\n'))
    must(retitleDeck(dir, 'first', 'Second name'))
    expect(must(listDecks(dir))).toMatchObject([{ slug: 'first', title: 'Second name', slides: 2 }])
    expect(retitleDeck(dir, 'first', '  ').ok).toBe(false)
  })

  test('delete removes the file and its history', () => {
    const dir = project('delete')
    must(createDeck(dir, 'Gone'))
    must(recordedWrite(dir, 'gone', '# x\n', { agent: 'a', summary: 's' }))
    must(deleteDeck(dir, 'gone'))
    expect(must(listDecks(dir))).toEqual([])
    expect(must(history(dir, 'gone'))).toEqual([])
    expect(deleteDeck(dir, 'gone').ok).toBe(false)
  })

  test('slugs that are not deck names are refused', () => {
    const dir = project('slugs')
    for (const slug of ['../x', 'A', '-x', '', 'a/b', 'x'.repeat(81)]) {
      expect(readDeck(dir, slug).ok).toBe(false)
      expect(writeDeck(dir, slug, 'x').ok).toBe(false)
    }
  })

  test('with no project there is nowhere to read or write', () => {
    expect(listDecks(null).ok).toBe(false)
    expect(createDeck(null, 'x').ok).toBe(false)
    expect(createDeck('relative/path', 'x').ok).toBe(false)
  })

  test('a .kehikot that points out of the project is refused', () => {
    const dir = project('escaping')
    const elsewhere = project('elsewhere')
    symlinkSync(elsewhere, join(dir, '.kehikot'))
    expect(createDeck(dir, 'x').ok).toBe(false)
    expect(listDecks(dir).ok).toBe(false)
    expect(existsSync(join(elsewhere, 'slides'))).toBe(false)
  })

  test('a deck file that points out of the project is neither read nor listed', () => {
    const dir = project('escaping-file')
    const outside = join(project('outside'), 'secret.md')
    writeFileSync(outside, '# secret\n')
    must(createDeck(dir, 'Real'))
    symlinkSync(outside, join(dir, '.kehikot', 'slides', 'leak.md'))
    expect(readDeck(dir, 'leak').ok).toBe(false)
    expect(writeDeck(dir, 'leak', 'x').ok).toBe(false)
    expect(must(listDecks(dir)).map((one) => one.slug)).toEqual(['real'])
    expect(readFileSync(outside, 'utf8')).toBe('# secret\n')
  })
})

describe('the undo trail', () => {
  test('a recorded write keeps the text before it, and undo puts it back (and is itself undoable)', () => {
    const dir = project('undo')
    const made = must(createDeck(dir, 'Deck'))
    const { id } = must(recordedWrite(dir, 'deck', '# agent was here\n', { agent: 'claude', summary: 'rewrote it' }))
    const entries = must(history(dir, 'deck'))
    expect(entries).toMatchObject([{ id, slug: 'deck', agent: 'claude', summary: 'rewrote it' }])
    expect('before' in entries[0]!).toBe(false)

    must(undo(dir, 'deck', id))
    expect(must(readDeck(dir, 'deck')).text).toBe(made.text)
    const after = must(history(dir, 'deck'))
    expect(after[0]).toMatchObject({ agent: 'person', summary: 'undo: rewrote it' })

    must(undo(dir, 'deck', after[0]!.id))
    expect(must(readDeck(dir, 'deck')).text).toBe('# agent was here\n')
    expect(undo(dir, 'deck', 'nope')).toMatchObject({ ok: false, status: 404 })
  })

  test('undoing a creation removes the deck', () => {
    const dir = project('undo-create')
    const made = must(createDeck(dir, 'Fresh'))
    const id = record(dir, made.slug, null, { agent: 'claude', summary: 'created' })
    expect(must(undo(dir, made.slug, id)).version).toBeNull()
    expect(readDeck(dir, made.slug).ok).toBe(false)
  })

  test('keeps the last 50 entries of each deck, and leaves other decks’ entries alone', () => {
    const dir = project('cap')
    must(createDeck(dir, 'One'))
    must(createDeck(dir, 'Two'))
    must(recordedWrite(dir, 'two', '# two\n', { agent: 'a', summary: 'two' }))
    for (let i = 0; i < 55; i++) must(recordedWrite(dir, 'one', `# ${i}\n`, { agent: 'a', summary: `edit ${i}` }))
    const entries = must(history(dir, 'one'))
    expect(entries.length).toBe(50)
    expect(entries[0]?.summary).toBe('edit 54')
    expect(entries[49]?.summary).toBe('edit 5')
    expect(must(history(dir, 'two')).length).toBe(1)
  })
})

describe('a picture a slide names', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const PDF = Buffer.from('%PDF-1.7\n')
  const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

  /** A project with a deck in it, pictures, and things that are not pictures. */
  function made(name: string): string {
    const root = realpathSync(project(name))
    must(createDeck(root, 'Talk'))
    for (const dir of ['figures', '.git', '.kehikot/paper/thesis/figures', '.kehikot/paper/thesis/.cache', '.kehikot/notes']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    writeFileSync(join(root, 'figures', 'one.png'), PNG)
    writeFileSync(join(root, 'figures', 'drawn.svg'), SVG)
    writeFileSync(join(root, 'figures', 'page.svg'), '<html><script>alert(1)</script></html>')
    writeFileSync(join(root, 'figures', 'renamed.png'), 'TOKEN=1')
    writeFileSync(join(root, 'figures', 'empty.png'), '')
    writeFileSync(join(root, 'figures', 'huge.png'), Buffer.concat([PNG, Buffer.alloc(MAX_PICTURE_BYTES)]))
    writeFileSync(join(root, '.env'), 'TOKEN=1')
    writeFileSync(join(root, '.hidden.png'), PNG)
    writeFileSync(join(root, 'notes.md'), '# notes')
    writeFileSync(join(root, '.git', 'packed.png'), PNG)
    writeFileSync(join(root, '.kehikot', 'paper', 'thesis', 'figures', 'flow.pdf'), PDF)
    writeFileSync(join(root, '.kehikot', 'paper', 'thesis', '.cache', 'kept.png'), PNG)
    writeFileSync(join(root, '.kehikot', 'notes', 'pasted.png'), PNG)
    return root
  }

  test('a picture inside the project is served with its type, whichever way the path is spelled', () => {
    const root = made('pictures')
    expect(pictureBytes(root, 'figures/one.png')).toEqual({ bytes: PNG, type: 'image/png' })
    expect(pictureBytes(root, './figures/one.png')?.type).toBe('image/png')
    expect(pictureBytes(root, 'figures/drawn.svg')?.type).toBe('image/svg+xml')
    /* A paper's figures: the one dot-folder that is read, and the one place a PDF is the picture. */
    expect(pictureBytes(root, '.kehikot/paper/thesis/figures/flow.pdf')?.type).toBe('application/pdf')
  })

  test('what is not a picture is not served, by its name or by its bytes', () => {
    const root = made('not-pictures')
    for (const path of ['.env', 'notes.md', 'figures', 'figures/', '', 'figures/missing.png', 'figures/renamed.png', 'figures/page.svg', 'figures/empty.png', 'figures/huge.png']) {
      expect([path, pictureBytes(root, path)]).toEqual([path, null])
    }
  })

  test('a path that leaves the project, or goes through a dot-folder, is refused', () => {
    const root = made('confined')
    writeFileSync(join(home, 'outside.png'), PNG)
    const refused = [
      '../outside.png',
      'figures/../../outside.png',
      'figures/../figures/one.png',
      join(root, 'figures', 'one.png'),
      '.hidden.png',
      '.git/packed.png',
      'figures/../.git/packed.png',
      '.kehikot/notes/pasted.png',
      '.kehikot/paper/thesis/.cache/kept.png',
      '.kehikot/paper/../../.git/packed.png',
      'figures/one.png\0.md',
    ]
    for (const path of refused) expect([path, pictureBytes(root, path)]).toEqual([path, null])
  })

  test('a link out of the project is refused, whether it is the picture or a folder on the way to it', () => {
    const root = made('links')
    const outside = realpathSync(project('links-outside'))
    writeFileSync(join(outside, 'far.png'), PNG)
    symlinkSync(join(outside, 'far.png'), join(root, 'figures', 'link.png'))
    symlinkSync(outside, join(root, 'elsewhere'))
    symlinkSync(join(root, '.git'), join(root, 'innocent'))
    symlinkSync(join(root, 'figures'), join(root, 'alias'))
    expect(pictureBytes(root, 'figures/link.png')).toBeNull()
    expect(pictureBytes(root, 'elsewhere/far.png')).toBeNull()
    /* Inside the project, but a dot-folder once resolved. */
    expect(pictureBytes(root, 'innocent/packed.png')).toBeNull()
    /* A link that stays inside, to somewhere a picture may be, is only another name for it. */
    expect(pictureBytes(root, 'alias/one.png')?.type).toBe('image/png')
  })

  test('only a project with a slides folder is read: no other directory is', () => {
    const bare = realpathSync(project('no-decks'))
    mkdirSync(join(bare, 'figures'))
    writeFileSync(join(bare, 'figures', 'one.png'), PNG)
    expect(pictureBytes(bare, 'figures/one.png')).toBeNull()
    expect(pictureBytes(null, 'figures/one.png')).toBeNull()
    expect(pictureBytes('relative/dir', 'figures/one.png')).toBeNull()
    expect(pictureBytes(join(home, 'not-there'), 'figures/one.png')).toBeNull()
  })
})

describe('a passage a slide cites', () => {
  const WORDS = 'The mean rating was highest.\n'

  /** A project with a deck in it, a chapter, a paper of its own, and things nobody cites. */
  function made(name: string): string {
    const root = realpathSync(project(name))
    must(createDeck(root, 'Talk'))
    for (const dir of ['chapters', '.git', '.kehikot/paper/thesis', '.kehikot/paper/thesis/.cache', '.kehikot/notes']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    writeFileSync(join(root, 'chapters', '4.tex'), WORDS)
    writeFileSync(join(root, '.kehikot', 'paper', 'thesis', 'main.tex'), WORDS)
    writeFileSync(join(root, '.kehikot', 'paper', 'thesis', '.cache', 'kept.tex'), WORDS)
    writeFileSync(join(root, '.kehikot', 'notes', 'notes.json'), WORDS)
    writeFileSync(join(root, '.env'), WORDS)
    writeFileSync(join(root, '.git', 'config'), WORDS)
    writeFileSync(join(root, 'chapters', '.draft.tex'), WORDS)
    return root
  }

  test('a chapter of the project and the paper kept in it are read, whichever way the path is spelled', () => {
    const root = made('cited')
    expect(citedText(root, 'chapters/4.tex')).toBe(WORDS)
    expect(citedText(root, './chapters/4.tex')).toBe(WORDS)
    expect(citedText(root, '.kehikot/paper/thesis/main.tex')).toBe(WORDS)
    expect(must(citedSlice(root, '.kehikot/paper/thesis/main.tex', 4, 8))).toBe('mean')
  })

  test('a dot-file or dot-folder on the way is not read, but for the paper’s own', () => {
    const root = made('cited-hidden')
    const refused = [
      '.env',
      './.env',
      '.git/config',
      'chapters/.draft.tex',
      '.kehikot/notes/notes.json',
      '.kehikot/slides/talk.md',
      '.kehikot/paper/thesis/.cache/kept.tex',
      '../cited/chapters/4.tex',
      'chapters/../.env',
      join(root, 'chapters', '4.tex'),
      'chapters',
      'chapters/missing.tex',
      '',
      'chapters/4.tex\0',
    ]
    for (const path of refused) expect([path, citedText(root, path)]).toEqual([path, null])
    expect(citedSlice(root, '.env', 0, 4)).toMatchObject({ ok: false, status: 404 })
  })

  test('a link is judged by where it leads: out of the project, or into a dot-folder', () => {
    const root = made('cited-links')
    const outside = project('cited-outside')
    writeFileSync(join(outside, 'far.tex'), WORDS)
    symlinkSync(join(outside, 'far.tex'), join(root, 'chapters', 'link.tex'))
    symlinkSync(outside, join(root, 'elsewhere'))
    symlinkSync(join(root, '.env'), join(root, 'chapters', 'plain.tex'))
    symlinkSync(join(root, '.git'), join(root, 'innocent'))
    symlinkSync(join(root, 'chapters'), join(root, 'alias'))
    expect(citedText(root, 'chapters/link.tex')).toBeNull()
    expect(citedText(root, 'elsewhere/far.tex')).toBeNull()
    expect(citedText(root, 'chapters/plain.tex')).toBeNull()
    expect(citedText(root, 'innocent/config')).toBeNull()
    /* A link that stays inside the project, to somewhere that is read, is followed. */
    expect(citedText(root, 'alias/4.tex')).toBe(WORDS)
  })

  test('a passage is read only from a project that has decks, and is bounded', () => {
    const root = made('cited-bounds')
    const bare = realpathSync(project('cited-bare'))
    writeFileSync(join(bare, 'notes.txt'), WORDS)
    expect(citedSlice(bare, 'notes.txt', 0, 4)).toMatchObject({ ok: false, status: 404 })
    expect(citedSlice(null, 'chapters/4.tex', 0, 4).ok).toBe(false)
    expect(citedSlice('relative/dir', 'chapters/4.tex', 0, 4).ok).toBe(false)
    expect(citedSlice(join(home, 'not-there'), 'chapters/4.tex', 0, 4).ok).toBe(false)
    expect(citedSlice(root, 'chapters/4.tex', 0, 4001).ok).toBe(false)
    expect(citedSlice(root, 'chapters/4.tex', 4, 4).ok).toBe(false)
    expect(citedSlice(root, 'chapters/4.tex', 0, 400).ok).toBe(false)
    expect(must(citedSlice(root, 'chapters/4.tex', 0, 3))).toBe('The')
  })
})
