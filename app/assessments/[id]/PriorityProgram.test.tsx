// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ClinicalProgramPriority, ClinicalProgramReport, ClinicalProgramStep } from '@/lib/program/clinicalProjection'
import PriorityProgram from './PriorityProgram'

afterEach(cleanup)

const reps = (sets: number, n: number) => ({ sets, reps: n, seconds: null, type: 'dynamic' as const })

function step(slug: string, name: string, stepLabel: string, alternatives: string[] = []): ClinicalProgramStep {
  return {
    stepLabel,
    slug,
    baseSlug: slug,
    name,
    category: 'strengthen',
    freq: 'daily',
    isIntegrative: false,
    repRange: { min: 8, max: 10 },
    weeks: [reps(1, 8), reps(2, 8), reps(2, 10)],
    alternatives: [{ slug, name }, ...alternatives.map((a) => ({ slug: a, name: a }))],
  } as ClinicalProgramStep
}

function priority(rank: number, key: string, label: string, steps: ClinicalProgramStep[]): ClinicalProgramPriority {
  return {
    rank,
    primaryKey: key,
    keys: [key],
    label,
    zone: 'warning',
    severityWord: 'mild',
    copy: { whatItMeans: `${label} explained.` },
    steps,
    hasConnect: false,
    screenedKeys: [key],
  } as unknown as ClinicalProgramPriority
}

const report = {
  hasPlan: true,
  priorities: [
    priority(1, 'forward_head_posture', 'Forward Head Posture', [
      step('cat-cow', 'Cat-Cow', 'Loosen', ['thread-the-needle']),
      step('chin-tucks', 'Chin Tucks', 'Strengthen'),
    ]),
    priority(2, 'trunk_lean', 'Trunk Lean', [step('dead-bug', 'Dead Bug', 'Strengthen')]),
  ],
  monitored: [],
  eligibleOrder: [],
  positives: [],
  screeningSummary: '2 corrective focuses were selected from reliable screening findings.',
  oneMoreToWatch: null,
  capability: 'standard',
} as unknown as ClinicalProgramReport

function renderProgram() {
  const handlers = { onDemote: vi.fn(), onPromote: vi.fn(), onSwap: vi.fn(), onCapabilityChange: vi.fn() }
  render(<PriorityProgram report={report} unreliable={[]} capability="standard" {...handlers} />)
  return handlers
}

describe('PriorityProgram (phone-first accordion)', () => {
  it('opens the first focus and keeps the rest collapsed to one line each', () => {
    renderProgram()
    const first = screen.getByRole('button', { name: /Forward Head Posture/ })
    const second = screen.getByRole('button', { name: /Trunk Lean/ })
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('exercise-detail-cat-cow')).toBeTruthy()
    expect(screen.queryByTestId('exercise-detail-dead-bug')).toBeNull()
    expect(second.textContent).toContain('1 exercise')
  })

  it('shows each exercise’s 3-week ramp as one line, with its swap and demote controls', () => {
    const { onSwap, onDemote } = renderProgram()
    expect(screen.getAllByText('1×8').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Week 1 \(learn & own\): 1×8\. Week 2 \(reinforce\): 2×8\. Week 3 \(consolidate\): 2×10\./).length).toBe(2)
    fireEvent.change(screen.getByTestId('swap-forward_head_posture-cat-cow'), { target: { value: 'thread-the-needle' } })
    expect(onSwap).toHaveBeenCalledWith('forward_head_posture', 'cat-cow', 'thread-the-needle')
    fireEvent.click(screen.getByTestId('demote-forward_head_posture'))
    expect(onDemote).toHaveBeenCalledWith('forward_head_posture')
  })

  it('opening another focus closes the open one', () => {
    renderProgram()
    fireEvent.click(screen.getByRole('button', { name: /Trunk Lean/ }))
    expect(screen.getByRole('button', { name: /Trunk Lean/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Forward Head Posture/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('exercise-detail-dead-bug')).toBeTruthy()
    expect(screen.queryByTestId('exercise-detail-cat-cow')).toBeNull()
  })
})
