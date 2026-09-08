// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ComparisonWorkspace, {
  type ComparisonAssessment,
  type ComparisonDeltaRow,
} from './ComparisonWorkspace'
import { compareOverallScores, compareSeverityPercentages } from '@/lib/comparison/policy'

afterEach(cleanup)

const assessments: ComparisonAssessment[] = [
  { id: 'latest', assessedAt: '2026-06-03T10:00:00.000Z', overallGrade: 'S', overallScore: 1, scoringEngineVersion: '2.0.0', status: 'approved' },
  { id: 'baseline', assessedAt: '2026-04-01T10:00:00.000Z', overallGrade: 'B', overallScore: 20, scoringEngineVersion: '2.0.0', status: 'approved' },
  { id: 'middle', assessedAt: '2026-05-02T10:00:00.000Z', overallGrade: 'A', overallScore: 7, scoringEngineVersion: '2.0.0', status: 'draft' },
]

const versionPair = {
  currentEngineVersion: '2.0.0',
  priorEngineVersion: '2.0.0',
  currentAssessedAt: '2026-06-03',
  priorAssessedAt: '2026-04-01',
}

const deltaRows: ComparisonDeltaRow[] = [
  {
    key: 'head_forward',
    label: 'Forward head',
    baseDeviation: 12,
    targetDeviation: 8,
    baseUnit: 'deg',
    targetUnit: 'deg',
    unit: 'deg',
    delta: -4,
    comparison: compareSeverityPercentages({ current: 45, prior: 50, ...versionPair }),
  },
  {
    key: 'shoulder_tilt',
    label: 'Shoulder tilt',
    baseDeviation: 3,
    targetDeviation: 5,
    baseUnit: 'deg',
    targetUnit: 'deg',
    unit: 'deg',
    delta: 2,
    comparison: compareSeverityPercentages({ current: 55, prior: 50, ...versionPair }),
  },
]

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof ComparisonWorkspace>> = {}) {
  const props: React.ComponentProps<typeof ComparisonWorkspace> = {
    assessments,
    baseId: 'baseline',
    targetId: 'latest',
    deltaRows,
    overallComparison: compareOverallScores({ current: 1, prior: 20, ...versionPair }),
    onBaseChange: vi.fn(),
    onTargetChange: vi.fn(),
    ...overrides,
  }
  render(<ComparisonWorkspace {...props} />)
  return props
}

describe('ComparisonWorkspace', () => {
  it('keeps the After choices strictly later than the selected Before assessment', () => {
    const props = renderWorkspace()
    const before = screen.getByLabelText('Before (baseline)')
    const after = screen.getByLabelText('After (comparison)')

    expect(within(after).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
      'middle',
      'latest',
    ])

    fireEvent.change(before, { target: { value: 'middle' } })
    fireEvent.change(after, { target: { value: 'latest' } })
    expect(props.onBaseChange).toHaveBeenCalledWith('middle')
    expect(props.onTargetChange).toHaveBeenCalledWith('latest')
  })

  it('renders Before, transition, and After in a stable semantic sequence', () => {
    renderWorkspace()
    const sequence = screen.getByRole('region', { name: 'Selected assessment sequence' })
    const headings = within(sequence).getAllByRole('heading', { level: 3 })

    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Before assessment',
      'Change summary',
      'After assessment',
    ])
    expect(within(sequence).getByText(/Screening score decreased · −19\.0 score points/)).toBeTruthy()
    expect(within(sequence).getByText(/repeat-capture variability/i)).toBeTruthy()
  })

  it('labels numeric evidence as neutral recorded changes without outcome language', () => {
    renderWorkspace()
    const evidence = screen.getByRole('list', { name: 'Finding comparison evidence' })

    expect(within(evidence).getByText('Forward head')).toBeTruthy()
    expect(within(evidence).getByText('-4.0deg')).toBeTruthy()
    expect(within(evidence).getByText(/Recorded severity decreased · −5\.0 percentage points/)).toBeTruthy()
    expect(within(evidence).getByText('+2.0deg')).toBeTruthy()
    expect(within(evidence).getByText(/Recorded severity increased · \+5\.0 percentage points/)).toBeTruthy()
    expect(evidence.textContent).not.toMatch(/improv|regress|better|worse/i)
    expect(screen.queryByText(/lower is better/i)).toBeNull()
  })

  it('explains when the selected assessments have no comparable findings', () => {
    renderWorkspace({ deltaRows: [] })

    expect(screen.getByRole('status').textContent).toContain('No comparable findings')
  })

  it('shows the direction of a one-point recorded score difference without interpreting it', () => {
    renderWorkspace({
      overallComparison: compareOverallScores({ current: 20, prior: 21, ...versionPair }),
    })
    expect(screen.getByText(/Screening score decreased · −1\.0 score points/)).toBeTruthy()
    expect(screen.queryByText(/measurement tolerance/i)).toBeNull()
  })

  it('shows cross-version assessments as not comparable', () => {
    renderWorkspace({
      overallComparison: compareOverallScores({
        current: 1,
        prior: 20,
        currentEngineVersion: '2.0.0',
        priorEngineVersion: '1.0.0',
        currentAssessedAt: '2026-06-03',
        priorAssessedAt: '2026-04-01',
      }),
    })
    expect(screen.getAllByText(/^Not comparable:/)).not.toHaveLength(0)
    expect(screen.getAllByText(/different or missing scoring versions/)).not.toHaveLength(0)
  })

  it('labels each raw measurement with its own unit when units differ', () => {
    renderWorkspace({
      deltaRows: [{
        key: 'legacy-unit-change',
        label: 'Legacy unit change',
        baseDeviation: 2,
        targetDeviation: 3,
        baseUnit: 'deg',
        targetUnit: 'cm',
        unit: '',
        delta: null,
        comparison: compareSeverityPercentages({
          current: 55,
          prior: 50,
          currentUnit: 'cm',
          priorUnit: 'deg',
          ...versionPair,
        }),
      }],
    })

    const row = screen.getByText('Legacy unit change').closest('li')!
    expect(within(row).getByText('2.0deg')).toBeTruthy()
    expect(within(row).getByText('3.0cm')).toBeTruthy()
    expect(within(row).getByText('Not comparable: the recorded measurement units differ.')).toBeTruthy()
  })
})
