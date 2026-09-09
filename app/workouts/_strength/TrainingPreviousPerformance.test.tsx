// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createLoadQuantity } from '@/lib/training/quantity'
import Panel from './TrainingPreviousPerformance'

const request = { sessionId: 'current', exerciseInstanceId: 'press' }
const payload = { schemaVersion: 'training-previous-performance.v1', request, result: {
  kind: 'available', source: { sessionId: 'prior', exerciseInstanceId: 'prior-press', sessionRevision: 4,
    sourceRevisionId: 'source-1', prescriptionSourceRevisionId: 'prescription-1', progressionSeriesId: 'series-1',
    scheduledLocalDate: '2026-09-01', completedAt: '2026-09-01T12:00:00.000Z', executionContext: { kind: 'live' },
    effectiveEvents: [{ eventId: 'event-1', eventRevision: 2 }],
  }, sets: [{ ordinal: 1, load: { equipmentId: 'dumbbell-1', basis: 'dumbbell_per_hand', quantity: createLoadQuantity({ value: '22.50', unit: 'lb' }) }, reps: 7, rir: 'unknown', side: 'bilateral' }],
} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('previous comparable performance', () => {
  it('shows exact entered quantity and unknown effort without guessing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)))
    render(<Panel {...request} />)
    expect(await screen.findByText(/22.50 lb · per dumbbell · 7 reps · RIR not recorded/)).toBeTruthy()
    expect(screen.getByText('2026-09-01')).toBeTruthy()
  })
  it('rejects a response for another requested exercise and can retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ ...payload, request: { ...request, exerciseInstanceId: 'other' } })).mockResolvedValueOnce(response(payload))
    vi.stubGlobal('fetch', fetcher)
    render(<Panel {...request} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry previous performance' }))
    await screen.findByText(/22.50 lb/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('clears prior results on session change and represents absence without zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(payload)).mockResolvedValueOnce(response({ ...payload, request: { ...request, sessionId: 'next' }, result: { kind: 'none', reason: 'no_comparable_completed_exposure' } })))
    const view = render(<Panel {...request} />)
    await screen.findByText(/22.50 lb/)
    view.rerender(<Panel {...request} sessionId="next" />)
    expect(screen.queryByText(/22.50 lb/)).toBeNull()
    await screen.findByText('No comparable saved session yet.')
  })
  it.each([
    ['bodyweight_external', '0', '0 kg · added external load'],
    ['machine_assistance', '35', '35 kg · assistance provided by the machine'],
  ] as const)('labels %s history without body-mass or signed-load interpretation', async (basis, value, label) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ...payload,
      result: {
        ...payload.result,
        source: {
          ...payload.result.source,
          bodyweightAssistancePolicy: { policyId: 'policy-1', policyVersion: 'policy-v1' },
        },
        sets: [{
          ...payload.result.sets[0],
          load: { equipmentId: basis === 'bodyweight_external' ? 'belt' : 'assist', basis, quantity: createLoadQuantity({ value, unit: 'kg' }) },
        }],
      },
    })))
    render(<Panel {...request} />)
    expect(await screen.findByText(new RegExp(label))).toBeTruthy()
  })
})
