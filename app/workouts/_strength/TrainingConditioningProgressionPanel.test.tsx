// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import Panel from './TrainingConditioningProgressionPanel'

const origin = { kind: 'synthetic_fixture', sourceVersion: 'policy.v1', fixtureId: 'fixture.v1', fixtureHash: 'a'.repeat(64), label: 'Sample policy' }
const decision = {
  kind: 'duration_proposal', status: 'proposed', policyVersion: 'conditioning-duration-v1', policyOrigin: origin,
  decisionKey: `conditioning-duration-v1:sha256:${'b'.repeat(64)}`, subjectId: 'subject-1', assignmentId: 'assignment-1',
  baseProgramRevisionNumber: 1, sourceProfileRevision: 1, sourceEligibilityRevisionId: 'eligibility-1',
  executionContext: { kind: 'live' }, modalityId: 'walking.v1', targetEffortMaximum: 4, sourceSessionRevisions: [],
  reason: 'two_comparable_bouts_completed', increaseSecondsPerBout: 60,
  targetBouts: [1, 2].map(i => ({ sessionId: `session-${i}`, sessionRevision: 1, boutId: `bout-${i}`, acceptedDurationSeconds: 660 })),
}
const proposalId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const projection = { schemaVersion: 'conditioning-progression-projection.v1', result: { kind: 'proposal', proposalId, decision } }
const receipt = { schemaVersion: 'conditioning-progression-acceptance.v1', proposalId, assignmentId: 'assignment-1', programRevisionNumber: 2, targetBoutIds: ['bout-1', 'bout-2'], policyVersion: decision.policyVersion, policyOrigin: origin }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('conditioning target review', () => {
  it.each([
    ['insufficient_history', 'Complete two comparable conditioning sessions before reviewing an increase.'],
    ['no_pending_targets', 'No later conditioning targets are waiting.'],
  ] as const)('renders the normal %s outcome without a service error', async (kind, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      schemaVersion: 'conditioning-progression-projection.v1',
      result: { kind, proposalId: null },
    })))
    render(<Panel sessionId="source-session" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review conditioning targets' }))
    await screen.findByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept conditioning targets' })).toBeNull()
  })

  it('explains a hold without offering acceptance and labels sample policy', async () => {
    const { increaseSecondsPerBout, targetBouts, ...audit } = decision
    expect(increaseSecondsPerBout).toBe(60)
    expect(targetBouts).toHaveLength(2)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ schemaVersion: projection.schemaVersion, result: {
      kind: 'not_proposed', proposalId: null, decision: { ...audit, kind: 'hold', status: 'not_proposed', reason: 'effort_unknown_hold' },
    } })))
    render(<Panel sessionId="source-session" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review conditioning targets' }))
    await screen.findByText(/Record perceived effort in both sessions/)
    expect(screen.queryByRole('button', { name: 'Accept conditioning targets' })).toBeNull()
    expect(screen.getByText(/This suggestion uses a sample policy/)).toBeTruthy()
  })

  it('requires explicit acceptance and retries an ambiguous response with the same identity', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(projection)).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(response(receipt))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel sessionId="source-session" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review conditioning targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry conditioning acceptance' }))
    await screen.findByText('Conditioning targets accepted for the two upcoming bouts.')
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body)
    expect(screen.getByText('Upcoming bout 1: 10 → 11 minutes')).toBeTruthy()
  })

  it('does not acknowledge a receipt for different targets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(projection)).mockResolvedValueOnce(response({ ...receipt, targetBoutIds: ['other-1', 'other-2'] })))
    render(<Panel sessionId="source-session" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review conditioning targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning targets' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be verified')
    expect(screen.queryByText('Conditioning targets accepted for the two upcoming bouts.')).toBeNull()
  })

  it('requires refresh after a stale decision and clears state on session change', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(projection)).mockResolvedValueOnce(response({}, 409))
    vi.stubGlobal('fetch', fetcher)
    const view = render(<Panel sessionId="source-session" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review conditioning targets' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning targets' }))
    await screen.findByRole('button', { name: 'Refresh conditioning suggestion' })
    expect(screen.queryByRole('button', { name: 'Accept conditioning targets' })).toBeNull()
    view.rerender(<Panel sessionId="another-session" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review conditioning targets' })).toBeTruthy())
    expect(screen.queryByText('Upcoming bout 1: 10 → 11 minutes')).toBeNull()
  })
})
