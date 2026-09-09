// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Panel from './TrainingConditioningRevisionPanel'

const assignmentId = 'assignment-1'
const proposalId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const options = {
  schemaVersion: 'conditioning-revision-options.v1',
  result: {
    kind: 'options', assignmentId, subjectId: 'subject-1', executionContext: { kind: 'live' },
    currentLocalDate: '2030-01-01', athleteTimezone: 'America/Los_Angeles',
    changeableBouts: [
      { boutId: 'bout-1', modalityId: 'walk.v1', scheduledLocalDate: '2030-01-08', acceptedDurationSeconds: 661, arrangement: 'separate' },
      { boutId: 'bout-2', modalityId: 'walk.v1', scheduledLocalDate: '2030-01-11', acceptedDurationSeconds: 720, arrangement: 'separate' },
    ],
    modalities: [
      { modalityId: 'walk.v1', label: 'Walking', existingModeDurationMaximumSeconds: 1800, newModeDurationMaximumSeconds: 1200, strengthFirstPairingAvailable: false },
      { modalityId: 'cycle.v1', label: 'Cycling', existingModeDurationMaximumSeconds: 1800, newModeDurationMaximumSeconds: 1200, strengthFirstPairingAvailable: true },
    ],
  },
}
const replacements = options.result.changeableBouts.map((bout, index) => ({
  sourceBoutId: bout.boutId,
  priorModalityId: 'walk.v1',
  priorScheduledLocalDate: bout.scheduledLocalDate,
  priorAcceptanceId: `acceptance-${index + 1}`,
  modalityId: 'cycle.v1',
  scheduledLocalDate: index === 0 ? '2030-01-09' : '2030-01-12',
  athleteTimezone: options.result.athleteTimezone,
  acceptedDurationSeconds: index === 0 ? 661 : 720,
  effortCue: 'Keep the saved moderate effort target.',
  arrangement: 'separate',
  evidenceBoundary: { kind: 'reset', reason: 'modality_changed' },
  comparability: { kind: 'new_series', reason: 'modality_changed_recalibration' },
}))
const readyProjection = {
  schemaVersion: 'conditioning-revision-projection.v1', proposalId,
  revision: { schemaVersion: 'conditioning-revision.v1', result: {
    kind: 'revision_ready', status: 'requires_explicit_revision_acceptance', assignmentId,
    subjectId: 'subject-1', baseProgramRevisionNumber: 3,
    compiledProgramRevisionId: 'compiled-3', compilerPolicyVersion: 'strength-cycle-compiler.v3',
    catalogVersion: 'conditioning-catalog.v1', executionContext: { kind: 'live' },
    preservedBoutIds: [], replacements,
    frequencyChange: 'unchanged', intensityChange: 'not_automated', strengthPriority: 'strength_first_when_paired',
  } },
}
const receipt = {
  schemaVersion: 'conditioning-revision-acceptance.v1', proposalId, assignmentId,
  programRevisionNumber: 4, affectedBoutIds: ['bout-1', 'bout-2'], evidenceBoundary: 'reset',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function renderLoaded(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetcher)
  render(<Panel assignmentId={assignmentId} />)
  await screen.findByRole('form', { name: 'Edit future conditioning' })
}

function submitPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview conditioning changes' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TrainingConditioningRevisionPanel', () => {
  it('loads assignment-bound options and renders a clear exact preview', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(options)).mockResolvedValueOnce(json(readyProjection))
    await renderLoaded(fetcher)
    submitPreview()
    expect(await screen.findByRole('heading', { name: 'Confirm future conditioning changes' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('2030-01-09: Walking → Cycling; 11 min 1 sec')
    expect(screen.getByText(/starts a new evidence window/)).toBeTruthy()
    expect(screen.getByText(/Effort is not increased automatically/)).toBeTruthy()
    expect(fetcher.mock.calls[0][0]).toBe('/api/training/conditioning/revisions?assignmentId=assignment-1')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      assignmentId,
      selection: {
        replacementModalityId: 'walk.v1',
        futureBouts: options.result.changeableBouts.map(bout => ({
          sourceBoutId: bout.boutId, scheduledLocalDate: bout.scheduledLocalDate,
          acceptedDurationSeconds: bout.acceptedDurationSeconds, arrangement: bout.arrangement,
        })),
      },
    })
  })

  it('locks the form while a preview is pending and prevents duplicate submission', async () => {
    let resolvePreview!: (value: Response) => void
    const pendingPreview = new Promise<Response>(resolve => { resolvePreview = resolve })
    const fetcher = vi.fn().mockResolvedValueOnce(json(options)).mockReturnValueOnce(pendingPreview)
    await renderLoaded(fetcher)
    submitPreview()
    expect(await screen.findByText('Preparing conditioning preview…')).toBeTruthy()
    expect((screen.getByRole('group', { name: 'Future conditioning' }) as HTMLFieldSetElement).disabled).toBe(true)
    submitPreview()
    expect(fetcher).toHaveBeenCalledTimes(2)
    resolvePreview(json(readyProjection))
    await screen.findByRole('heading', { name: 'Confirm future conditioning changes' })
  })

  it('keeps the form locked after a lost acknowledgement and retries the exact request', async () => {
    const callback = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(options))
      .mockResolvedValueOnce(json(readyProjection))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(json(receipt))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb') })
    render(<Panel assignmentId={assignmentId} onAccepted={callback} />)
    await screen.findByRole('form', { name: 'Edit future conditioning' })
    submitPreview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning revision' }))
    const retry = await screen.findByRole('button', { name: 'Retry conditioning acceptance' })
    expect(screen.queryByRole('button', { name: 'Edit changes' })).toBeNull()
    expect((screen.getByRole('group', { name: 'Future conditioning' }) as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.click(retry)
    await screen.findByText(/Conditioning revision accepted/)
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[3][1].body)
    expect(callback).toHaveBeenCalledWith(receipt)
  })

  it.each([
    ['proposal identity', { proposalId: 'dddddddd-dddd-4ddd-addd-dddddddddddd' }],
    ['assignment identity', { assignmentId: 'assignment-2' }],
    ['revision', { programRevisionNumber: 5 }],
    ['exact affected bouts', { affectedBoutIds: ['bout-1', 'bout-3'] }],
    ['unique affected bouts', { affectedBoutIds: ['bout-1', 'bout-1'] }],
    ['evidence boundary', { evidenceBoundary: 'preserved' }],
  ] as const)('does not trust an invalid %s receipt and preserves its request identity for retry', async (_label, change) => {
    const invalid = { ...receipt, ...change }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(options))
      .mockResolvedValueOnce(json(readyProjection))
      .mockResolvedValueOnce(json(invalid))
      .mockResolvedValueOnce(json(receipt))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'cccccccc-cccc-4ccc-accc-cccccccccccc') })
    render(<Panel assignmentId={assignmentId} />)
    await screen.findByRole('form', { name: 'Edit future conditioning' })
    submitPreview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning revision' }))
    expect((await screen.findByRole('alert')).textContent).toContain('receipt could not be verified')
    fireEvent.click(screen.getByRole('button', { name: 'Retry conditioning acceptance' }))
    await screen.findByText(/Conditioning revision accepted/)
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[3][1].body)
  })

  it('blocks an acceptance denied after a valid preview', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(options))
      .mockResolvedValueOnce(json(readyProjection))
      .mockResolvedValueOnce(json({}, 403))
    await renderLoaded(fetcher)
    submitPreview()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept conditioning revision' }))
    expect((await screen.findByRole('alert')).textContent).toContain('do not have permission')
    expect(screen.queryByRole('button', { name: 'Retry conditioning acceptance' })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Edit future conditioning' })).toBeNull()
  })

  it('rejects a proposal projection from another option source', async () => {
    const mismatch = { ...readyProjection, revision: { ...readyProjection.revision, result: {
      ...readyProjection.revision.result, subjectId: 'another-subject',
    } } }
    await renderLoaded(vi.fn().mockResolvedValueOnce(json(options)).mockResolvedValueOnce(json(mismatch)))
    submitPreview()
    expect((await screen.findByRole('alert')).textContent).toContain('does not match the loaded program')
    expect(screen.queryByRole('button', { name: 'Accept conditioning revision' })).toBeNull()
  })

  it('renders typed conflicts with off-day and strength-first alternatives', async () => {
    const conflict = {
      schemaVersion: 'conditioning-revision-projection.v1', proposalId: null,
      revision: { schemaVersion: 'conditioning-revision.v1', result: {
        kind: 'reschedule_required', reason: 'explicit_schedule_resolution_required', conflicts: [{
          sourceBoutId: 'bout-1', requestedLocalDate: '2030-01-09', reason: 'strength_date_requires_arrangement',
          collidingSessionId: 'strength-1', offDayAlternatives: ['2030-01-08', '2030-01-10'], pairedOptionAvailable: true,
        }],
      } },
    }
    await renderLoaded(vi.fn().mockResolvedValueOnce(json(options)).mockResolvedValueOnce(json(conflict)))
    submitPreview()
    await screen.findByRole('heading', { name: 'Choose another schedule' })
    expect(screen.getByText(/Available off days: 2030-01-08, 2030-01-10/)).toBeTruthy()
    expect(screen.getByText(/strength is completed first/)).toBeTruthy()
  })

  it('requires a refresh after 409 and remounts the form from current options', async () => {
    const refreshed = { ...options, result: { ...options.result, changeableBouts: options.result.changeableBouts.map((bout, index) => ({
      ...bout, scheduledLocalDate: index === 0 ? '2030-01-10' : bout.scheduledLocalDate,
    })) } }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(options))
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json(refreshed))
    await renderLoaded(fetcher)
    fireEvent.change(screen.getAllByLabelText('Date')[0], { target: { value: '2030-01-09' } })
    submitPreview()
    const reload = await screen.findByRole('button', { name: 'Reload conditioning options' })
    expect(screen.queryByRole('form', { name: 'Edit future conditioning' })).toBeNull()
    fireEvent.click(reload)
    await waitFor(() => expect((screen.getAllByLabelText('Date')[0] as HTMLInputElement).value).toBe('2030-01-10'))
  })

  it.each([401, 403])('blocks revision access on HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, status)))
    render(<Panel assignmentId={assignmentId} />)
    expect((await screen.findByRole('alert')).textContent).toContain('do not have permission')
    expect(screen.queryByRole('form', { name: 'Edit future conditioning' })).toBeNull()
  })
})
