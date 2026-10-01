import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDeck } from '../deck/format.ts'
import {
  createDeck,
  deleteDeck,
  history,
  listDecks,
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
