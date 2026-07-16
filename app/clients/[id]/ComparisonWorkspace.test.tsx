// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ComparisonWorkspace, {
  type ComparisonAssessment,
  type ComparisonDeltaRow,
} from './ComparisonWorkspace'

afterEach(cleanup)

const assessments: ComparisonAssessment[] = [
  { id: 'latest', assessedAt: '2026-06-03T10:00:00.000Z', overallGrade: 'S', status: 'approved' },
  { id: 'baseline', assessedAt: '2026-04-01T10:00:00.000Z', overallGrade: 'B', status: 'approved' },
  { id: 'middle', assessedAt: '2026-05-02T10:00:00.000Z', overallGrade: 'A', status: 'draft' },
]

const deltaRows: ComparisonDeltaRow[] = [
  {
    key: 'head_forward',
    label: 'Forward head',
    baseDeviation: 12,
    targetDeviation: 8,
    unit: 'deg',
    delta: -4,
    improved: true,
  },
  {
    key: 'shoulder_tilt',
    label: 'Shoulder tilt',
    baseDeviation: 3,
    targetDeviation: 5,
    unit: 'deg',
    delta: 2,
    improved: false,
  },
]

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof ComparisonWorkspace>> = {}) {
  const props: React.ComponentProps<typeof ComparisonWorkspace> = {
    assessments,
    baseId: 'baseline',
    targetId: 'latest',
    deltaRows,
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
    expect(within(sequence).getByText('Improved')).toBeTruthy()
    expect(within(sequence).getByText('Lower severity indicates improvement.')).toBeTruthy()
  })

  it('labels numeric evidence and improvement direction without relying on color', () => {
    renderWorkspace()
    const evidence = screen.getByRole('list', { name: 'Finding comparison evidence' })

    expect(within(evidence).getByText('Forward head')).toBeTruthy()
    expect(within(evidence).getByText('-4.0deg')).toBeTruthy()
    expect(within(evidence).getByText('Improved — lower severity')).toBeTruthy()
    expect(within(evidence).getByText('+2.0deg')).toBeTruthy()
    expect(within(evidence).getByText('Regressed — higher severity')).toBeTruthy()
  })

  it('explains when the selected assessments have no comparable findings', () => {
    renderWorkspace({ deltaRows: [] })

    expect(screen.getByRole('status').textContent).toContain('No comparable findings')
  })
})
