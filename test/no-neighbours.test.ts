import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MODULE_FOLDERS, foldersOwned, manifestSchema, serviceDescriptor } from 'kehikot-module-protocol'

import { ID, MANIFEST } from '../manifest.ts'

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
  'tests', 'history', 'orchestrator', 'notifications', 'queue', 'browser', 'diagrams', 'editor', 'kanban', 'monitor', 'worktrees',
].filter((one) => one !== SELF)

/** Other modules' tools this module once named. */
const TOOLS = ['list_sections', 'read_paper', 'read_source', 'propose_edit', 'show_flow', 'read_flow', 'list_flows', 'write_screenplay', 'read_screenplay', 'quizzes', 'add_quiz', 'check_item']

/** Other modules' names that are never an everyday word here, in comments as well. ("Notes:" is deck syntax.) */
const NAMES = ['Journeys', 'Paper', 'Learning', 'Screenplay', 'Flows', 'Browser', 'Checklist', 'Explorer', 'Orchestrator', 'Factory', 'Kanban', 'Codex', 'Antigravity', 'OpenCode', 'Vibe']

const BANNED: { what: string; pattern: RegExp }[] = [
  ...MODULES.map((one) => ({ what: `kehikot.${one}`, pattern: new RegExp(`\\b(?:kehikot|roadmap)\\.${one}\\b`) })),
  ...MODULES.map((one) => ({ what: `.kehikot/${one}`, pattern: new RegExp(`\\.kehikot/${one}\\b`) })),
  ...TOOLS.map((one) => ({ what: one, pattern: new RegExp(`\\b${one}\\b`) })),
  ...NAMES.map((one) => ({ what: one, pattern: new RegExp(`\\b${one}\\b`) })),
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

describe('module.folders', () => {
  test('declares the slides folder, authored, under this module\'s name', () => {
    expect(manifestSchema.parse(MANIFEST).services?.[MODULE_FOLDERS]).toBeTruthy()
    const descriptor = serviceDescriptor(MODULE_FOLDERS, MANIFEST.services?.[MODULE_FOLDERS])
    expect(descriptor).not.toBeNull()
    expect(descriptor!.name).toBe(MANIFEST.name)
    expect(descriptor!.folders.map((one) => [one.folder, one.derived])).toEqual([['slides', false]])
    expect(foldersOwned([{ module: ID, descriptor: MANIFEST.services?.[MODULE_FOLDERS] } as never]).get('slides')?.module).toBe(ID)
  })

  test('the manifest names no other module', () => {
    const said = JSON.stringify(MANIFEST, null, 1).split('\n')
    expect(said.filter((line) => BANNED.some(({ pattern }) => pattern.test(line)))).toEqual([])
  })
})
