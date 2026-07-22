// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Empty = () => null
  const Line = ({ connectNulls, name }: { connectNulls?: boolean; name?: string }) => (
    <span data-testid="chart-line" data-connect-nulls={String(Boolean(connectNulls))}>{name}</span>
  )
  return {
    CartesianGrid: Empty,
    Legend: Empty,
    Line,
    LineChart: Container,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  }
})

import ProgressCharts from './ProgressCharts'

afterEach(cleanup)

describe('ProgressCharts version boundaries', () => {
  it('labels engine boundaries and never asks Recharts to bridge nulls', () => {
    render(
      <ProgressCharts
        trendData={[
          { date: 'Jan 1', scoring_engine_version: 'v2', segment_id: 'segment-1', overall_score: 20, overall_grade: 'B', fhp: 50 },
          { date: 'Feb 1', scoring_engine_version: null, segment_id: 'segment-2', overall_score: null, overall_grade: null, fhp: null },
          { date: 'Mar 1', scoring_engine_version: 'v3', segment_id: 'segment-3', overall_score: 7, overall_grade: 'A', fhp: 40 },
        ]}
        trendSegments={[
          { id: 'segment-1', scoringEngineVersion: 'v2' },
          { id: 'segment-2', scoringEngineVersion: null },
          { id: 'segment-3', scoringEngineVersion: 'v3' },
        ]}
        imbalanceKeys={['fhp']}
        imbalanceLabels={{ fhp: 'Forward head' }}
      />,
    )

    expect(screen.getAllByText(/Lines stop at/).length).toBeGreaterThanOrEqual(1)
    const versionKey = screen.getByLabelText('Scoring version segments')
    expect(versionKey.closest('details')).toBeNull()
    expect(versionKey.textContent).toContain('v2')
    expect(versionKey.textContent).toContain('Unknown — not comparable')
    expect(versionKey.textContent).toContain('v3')
    expect(screen.getAllByTestId('chart-line').every((line) => line.dataset.connectNulls === 'false')).toBe(true)
    expect(screen.getByText('— / 100')).toBeTruthy()
  })
})
