import type { ProposalDoorOptions, ProposalSite } from 'kehikot-module-protocol/proposals'
import { fileKeeper } from 'kehikot-module-protocol/proposals/store'

import { poke } from './live.ts'
import { ID } from './manifest.ts'
import { readDeck, recordedWrite } from './store.ts'

/**
 * Proposed changes to a deck: an agent proposes, the person accepts or declines
 * at the page (protocol 2.71.0, `kehikot-module-protocol/proposals`). The book
 * is `<project>/.kehikot/slides/proposals/all.json`; a deck's text is read with
 * `readDeck`, and an accepted proposal is written with `recordedWrite`, so it is
 * in the deck's history and can be undone like any other agent write.
 */
export const PROPOSALS: ProposalDoorOptions = {
  what: 'a deck',
  file: { name: 'deck', description: 'The deck’s slug, as list_decks prints it (its file name without .md).' },
  module: ID,
}

export const SITE: ProposalSite = {
  keeper: fileKeeper(ID),
  text(project, slug) {
    const read = readDeck(project, slug)
    return read.ok ? read.value.text : null
  },
  write(project, slug, text, proposal) {
    const written = recordedWrite(project, slug, text, { agent: 'the person', summary: `accepted a proposal by ${proposal.by.name}: ${proposal.why}` })
    if (!written.ok) return { ok: false, why: written.error }
    poke(project)
    return { ok: true }
  },
}
