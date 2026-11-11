import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Modules never name each other: what this module needs from another it finds as a protocol SERVICE
 * (`document.proposals`, asked of the host), and calls what the descriptor names. So no other module's
 * id, tool name or data folder is spelled in this module's code, manifest or tool descriptions.
 */

const ROOT = join(import.meta.dirname, '..')
const SKIP = new Set(['node_modules', 'dist', 'test', 'notes', 'docs', '.git', 'plugin'])
const CODE = /\.(ts|tsx|js|mjs|json|html|sh)$/
const SELF = 'slides'

const MODULES = [
  'paper', 'review', 'checklist', 'factory', 'flows', 'screenplay', 'journeys', 'references', 'atlas', 'citations',
  'notes', 'learning', 'source', 'diff', 'explorer', 'terminal', 'claude', 'codex', 'vibe', 'opencode', 'antigravity',
  'tests', 'history', 'orchestrator', 'notifications', 'queue', 'browser',
].filter((one) => one !== SELF)

/** Other modules' tools this module once named. */
const TOOLS = ['list_sections', 'read_paper', 'read_source', 'propose_edit']

const BANNED: { what: string; pattern: RegExp }[] = [
  ...MODULES.map((one) => ({ what: `kehikot.${one}`, pattern: new RegExp(`\\b(?:kehikot|roadmap)\\.${one}\\b`) })),
  ...MODULES.map((one) => ({ what: `.kehikot/${one}`, pattern: new RegExp(`\\.kehikot/${one}\\b`) })),
  ...TOOLS.map((one) => ({ what: one, pattern: new RegExp(`\\b${one}\\b`) })),
  { what: "['.kehikot', 'paper']", pattern: /\[\s*['"]\.kehikot['"]\s*,\s*['"]paper['"]/ },
]

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    if (SKIP.has(one.name)) return []
    const path = join(dir, one.name)
    if (one.isDirectory()) return files(path)
    return CODE.test(one.name) && one.name !== 'bun.lock' && one.name !== 'CHANGELOG.md' ? [path] : []
  })
}

describe('no neighbours', () => {
  test('no other module is named in the code', () => {
    const hits: string[] = []
    for (const file of files(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const { what, pattern } of BANNED) if (pattern.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1} names ${what}`)
      })
    }
    expect(hits).toEqual([])
  })
})
