import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'

import { file } from 'kehikot-module-protocol/proposals'

import { DECK, draw, fakeDecks, footItem, pressFooter } from './fakes.tsx'

afterEach(cleanup)

const proposal = () => {
  const made = file(DECK, { file: 'defence', scope: 'range', find: '- one', replace: '- one, stated plainly', why: 'Say it.', by: { kind: 'agent', name: 'claude' } })
  if (!made.ok) throw new Error(made.why)
  return made.proposal
}

describe('proposed changes on the screen', () => {
  test('an open proposal is drawn over the deck; Accept answers through the door and the footer counts it', async () => {
    const one = proposal()
    const fake = fakeDecks({}, { proposals: [one] })
    draw(fake, { drawsFooter: true })
    const panel = await screen.findByRole('region', { name: 'proposed changes' })
    expect(within(panel).getByText('Say it.')).toBeTruthy()
    expect(within(panel).getByText('proposed by claude')).toBeTruthy()
    await waitFor(() => expect(footItem<'text'>('proposals')?.text).toBe('1 proposed change'))
    expect(pressFooter('proposal-next')).toBe('Proposal 1 of 1.')
    await waitFor(() => expect(footItem<'text'>('proposals')?.text).toBe('Proposal 1 of 1'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(fake.of('answerProposal')).toHaveLength(1))
    expect(fake.of('answerProposal')[0]?.args[0]).toMatchObject({ id: one.id, decision: 'accept' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'proposed changes' })).toBeNull())
    await waitFor(() => expect(footItem('proposals')).toBeUndefined())
  })

  test('Decline with reason sends the reason', async () => {
    const one = proposal()
    const fake = fakeDecks({}, { proposals: [one] })
    draw(fake)
    const panel = await screen.findByRole('region', { name: 'proposed changes' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline with reason' }))
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Why (the agent reads this)' }), { target: { value: 'Too wordy.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(fake.of('answerProposal')).toHaveLength(1))
    expect(fake.of('answerProposal')[0]?.args[0]).toMatchObject({ id: one.id, decision: 'decline', reason: 'Too wordy.' })
  })
})
