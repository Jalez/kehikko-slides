import { createHash } from 'node:crypto'

import { LIMITS, PLACE_TOKEN } from 'kehikot-module-protocol'
import {
  openProposals,
  proposalDigester,
  type Proposal,
  type ProposalDigester,
  type ProposalDigesterOptions,
  type ProposalSite,
} from 'kehikot-module-protocol/proposals'
import { askHost } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * Telling the agent session that proposed changes to a deck what the person
 * made of them (`messages.notify`, under `agents:message`): ONCE, when the
 * person has answered every proposal that session has open on the deck and
 * nothing more was decided for 30 s — the protocol's follow-up digest
 * (`proposalDigester`, 2.75.0), never a message per decision. A declined
 * proposal's reason is in the digest.
 *
 * A courtesy, never the record: `list_proposals` says every decision whatever
 * happens here. A call that came without a place token, a host that is absent,
 * a restart inside the quiet while — each is silence.
 *
 * The filer is the place token its `propose_change` call came with, held in
 * memory only (a token speaks for a running session) and never written to the
 * book. The digester tells filers apart by `by.session`, which here is a hash
 * of that token, added to a proposal only on its way into the digester.
 */
export type Teller = (project: string, token: string, body: string) => void

const viaHost: Teller = (project, token, body) => {
  void askHost('messages.notify', { token, body, kind: 'report' }, { module: ID, project }).catch(() => {})
}

let teller: Teller = viaHost

/** The tests put a recorder here; `null` puts the host back. */
export function setTeller(next: Teller | null): void {
  teller = next ?? viaHost
}

/** Proposal id → the place token of the call that filed it. */
const filers = new Map<string, string>()
/** Session (a hash of a token) → that token. */
const tokens = new Map<string, string>()
const MOST = 500

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > MOST) map.delete(map.keys().next().value!)
}

/** A place token as a door's query carries it, or null when it is not one. */
export function placeToken(raw: string | null | undefined): string | null {
  return raw && PLACE_TOKEN.test(raw) ? raw : null
}

/**
 * After `propose_change` answered: remember whose it is. The library's answer
 * names the proposal ("Filed as <id>." or "Revised <id> …").
 */
export function rememberFiler(said: string, token: string | null): void {
  if (!token) return
  const id = /^(?:Filed as|Revised) (\S+?)[.\s]/.exec(said)?.[1]
  if (id) remember(filers, id, token)
}

function withSession(proposal: Proposal): Proposal {
  const token = filers.get(proposal.id)
  if (!token || proposal.by.kind !== 'agent') return proposal
  const session = createHash('sha256').update(token).digest('hex').slice(0, 32)
  remember(tokens, session, token)
  return { ...proposal, by: { ...proposal.by, session } }
}

type Timers = Pick<ProposalDigesterOptions, 'setTimer' | 'clearTimer' | 'quietMs'>

/* A waiting digest never keeps the process alive by itself. */
const unrefTimer = (run: () => void, ms: number): unknown => {
  const timer = setTimeout(run, ms)
  ;(timer as { unref?: () => void }).unref?.()
  return timer
}

let site: ProposalSite | null = null

function makeDigester(timers: Timers = {}): ProposalDigester {
  return proposalDigester({
    setTimer: unrefTimer,
    ...timers,
    open: (project, file) => (site ? openProposals(site, project, file).map(withSession) : []),
    send({ project, by, text }) {
      const token = by.session ? tokens.get(by.session) : undefined
      if (token) teller(project, token, text.slice(0, LIMITS.MESSAGE_BODY))
    },
  })
}

let digester = makeDigester()

/** The site whose open proposals hold a digest back (`proposals.ts`). */
export function digestSite(next: ProposalSite): void {
  site = next
}

/** `ProposalSite.onSettled`: a proposal was answered or withdrawn. */
export function digestSettled(project: string, proposal: Proposal): void {
  digester.settled(project, withSession(proposal))
}

/** The tests put fake timers here; with nothing, the real ones and the protocol's quiet while. */
export function resetDigester(timers?: Timers): void {
  digester.stop()
  digester = makeDigester(timers)
}

/** The module is stopping: what is still waiting is dropped (`list_proposals` keeps it). */
export function stopDigester(): void {
  digester.stop()
}
