import { DOCUMENT_PROPOSALS, documentsFolder } from 'kehikot-module-protocol'
import { findService, resolveDoorProject, type DoorProject } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * Which project is this folder? Asked of the host, in this server, wherever a folder a caller named
 * is about to be read or written under (protocol 2.3.0, `resolveDoorProject`). A page's word, or an
 * agent's, is not the host's.
 *
 * What is worked on is the path the answer gives back, never the folder that was asked about: a caller
 * that learnt a path before the folder was renamed is followed to where the project is now, once, and
 * only after the host has said the new path is the same project. A host that says no, and no host
 * answering at all, are refusals: nothing is read and nothing is written. A run that is going when its
 * project is renamed asks here too, to find where its record goes (`runs/spawn.ts`).
 */
export type Resolve = (folder: string) => Promise<DoorProject>

export const resolveProject: Resolve = (folder) => resolveDoorProject(folder)

let resolver: Resolve = resolveProject

/** For the tests: the host's answer, stubbed. `null` puts the real one back. */
export function setHostResolve(resolve: Resolve | null): void {
  resolver = resolve ?? resolveProject
}

export const resolveFolder: Resolve = (folder) => resolver(folder)

/**
 * The document this project's slides are about, when a module here provides one (`document.proposals`,
 * protocol 2.83.0): its name, its tools and the folder its documents are kept under. Asked of the host,
 * never spelled here — this module does not know which module keeps the document, nor where. Null when
 * nothing provides it or the host does not answer: then a slide reads and cites only the project's own
 * files, and nothing under a dot-folder.
 *
 * Kept a little while per project, since every picture a slide shows asks.
 */
export type Documents = { name: string; folder: string; sections: string; source: string }
export type FindDocuments = (project: string) => Promise<Documents | null>

const findDocuments: FindDocuments = async (project) => {
  const found = await findService(DOCUMENT_PROPOSALS, { module: ID, project })
  if (!found.ok) return null
  const { name, descriptor } = found.provider
  return { name, folder: documentsFolder(descriptor), sections: descriptor.tools.sections, source: descriptor.tools.source }
}

const DOCUMENTS_KEPT_MS = 30_000
const kept = new Map<string, { at: number; documents: Promise<Documents | null> }>()
let finder: FindDocuments = findDocuments

/** The document provider for a project (see {@link Documents}). Never throws. */
export function documentsOf(project: string): Promise<Documents | null> {
  const now = Date.now()
  const hit = kept.get(project)
  if (hit && now - hit.at < DOCUMENTS_KEPT_MS) return hit.documents
  const documents = finder(project).catch(() => null)
  kept.set(project, { at: now, documents })
  return documents
}

/** For the tests: who provides the document, stubbed. `null` puts the real question back. */
export function setDocuments(find: FindDocuments | null): void {
  finder = find ?? findDocuments
  kept.clear()
}
