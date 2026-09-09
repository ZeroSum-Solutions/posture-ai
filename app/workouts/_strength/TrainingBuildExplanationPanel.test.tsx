// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainingBuildExplanationPanel from './TrainingBuildExplanationPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const binding = { buildId: 'build-1', subjectId: 'subject-1', profileRevision: 3 }

function explanation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'training-build-explanation.v1',
    binding,
    source: 'deterministic_default',
    fallbackReason: 'selection_absent',
    facts: [
      { factId: 'fact.plan-overview.v1', text: '8-week draft with three strength sessions each week.' },
      { factId: 'fact.phase-outline.v1', text: 'The first week is familiarization.' },
    ],
    ...overrides,
  }
}

describe('TrainingBuildExplanationPanel', () => {
  it('requests and renders only a strictly parsed, exactly bound explanation', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(explanation()))
    vi.stubGlobal('fetch', fetch)
    render(<TrainingBuildExplanationPanel binding={binding} />)

    fireEvent.click(screen.getByRole('button', { name: 'Explain this draft' }))
    expect((screen.getByRole('button', { name: 'Explaining draft…' }) as HTMLButtonElement).disabled).toBe(true)
    await screen.findByText('8-week draft with three strength sessions each week.')

    expect(fetch).toHaveBeenCalledWith('/api/training/programs/builds/build-1/explanation', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    })
    expect(screen.getByText('The first week is familiarization.')).toBeTruthy()
    expect(screen.getByText(/do not change its targets/i)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Refresh explanation' })).toBeTruthy()
  })

  it.each([
    ['wrong build', explanation({ binding: { ...binding, buildId: 'build-2' } })],
    ['wrong subject', explanation({ binding: { ...binding, subjectId: 'subject-2' } })],
    ['wrong profile revision', explanation({ binding: { ...binding, profileRevision: 4 } })],
    ['extra provider prose', explanation({ prose: 'Use a different exercise.' })],
  ])('rejects a verified response with %s', async (_label, response) => {
    render(<TrainingBuildExplanationPanel binding={binding} loadExplanation={vi.fn(async () => response)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Explain this draft' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('8-week draft with three strength sessions each week.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Explain this draft' })).toBeTruthy()
  })

  it('discards a late response after the draft identity remounts', async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise<unknown>(resolve => { resolveFirst = resolve })
    const loadExplanation = vi.fn((buildId: string, signal: AbortSignal) => {
      void buildId
      void signal
      return first
    })
    const view = render(<TrainingBuildExplanationPanel key="source-1" binding={binding} loadExplanation={loadExplanation} />)

    fireEvent.click(screen.getByRole('button', { name: 'Explain this draft' }))
    const firstSignal = loadExplanation.mock.calls[0][1]
    const changedBinding = { buildId: 'build-2', subjectId: 'subject-2', profileRevision: 4 }
    view.rerender(<TrainingBuildExplanationPanel
      key="source-2"
      binding={changedBinding}
      loadExplanation={vi.fn(async () => explanation({ binding: changedBinding }))}
    />)
    expect(firstSignal?.aborted).toBe(true)
    resolveFirst(explanation())
    await Promise.resolve()

    expect(screen.queryByText('8-week draft with three strength sessions each week.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Explain this draft' })).toBeTruthy()
  })

  it('synchronously hides ready facts when the expected binding changes', async () => {
    const loadExplanation = vi.fn(async () => explanation())
    const view = render(<TrainingBuildExplanationPanel binding={binding} loadExplanation={loadExplanation} />)
    fireEvent.click(screen.getByRole('button', { name: 'Explain this draft' }))
    await screen.findByText('8-week draft with three strength sessions each week.')

    view.rerender(<TrainingBuildExplanationPanel
      binding={{ ...binding, subjectId: 'subject-2' }}
      loadExplanation={loadExplanation}
    />)

    expect(screen.queryByText('8-week draft with three strength sessions each week.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Explain this draft' })).toBeTruthy()
  })

  it('keeps the draft usable when the explanation endpoint is unavailable', async () => {
    render(<TrainingBuildExplanationPanel
      binding={binding}
      loadExplanation={vi.fn(async () => { throw new Error('offline') })}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Explain this draft' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/could not be verified/i))
    expect(screen.getByRole('button', { name: 'Explain this draft' })).toBeTruthy()
  })
})
