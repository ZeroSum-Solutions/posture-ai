// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MuscleModel3D, { toNeutralViewerEntries } from './MuscleModel3D'

afterEach(cleanup)

describe('toNeutralViewerEntries', () => {
  it('drops historical condition roles and emits the same neutral bilateral references', () => {
    const tight = toNeutralViewerEntries([{ slug: 'hamstrings', role: 'tight', severity: 90 }])
    const weak = toNeutralViewerEntries([{ slug: 'hamstrings', role: 'weak', severity: 10 }])

    expect(tight).toEqual(weak)
    expect(tight).toEqual([
      { muscle: 'hamstrings', side: 'left', color: 'amber', intensity: 2 },
      { muscle: 'hamstrings', side: 'right', color: 'amber', intensity: 2 },
    ])
  })

  it('keeps an asserted side and omits unknown viewer anatomy', () => {
    expect(toNeutralViewerEntries([
      { slug: 'gluteus-maximus', role: 'weak', side: 'right' },
      { slug: 'not-in-viewer', role: 'tight' },
    ])).toEqual([
      { muscle: 'gluteus_maximus', side: 'right', color: 'amber', intensity: 2 },
    ])
  })
})

describe('MuscleModel3D', () => {
  const findings = [{
    zone: 'priority',
    severity_pct: 72,
    tight_muscle_links: [{ slug: 'hamstrings', name: 'Hamstrings', confidence: 'high' as const }],
  }]

  it('presents the model as a neutral anatomy reference with a clear load action', () => {
    render(<MuscleModel3D findings={findings} />)

    expect(screen.getByRole('heading', { name: 'Explore assessment-linked regions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /open interactive 3d anatomy/i })).toBeTruthy()
    expect(screen.getByText(/did not test muscle tightness, strength, inhibition, or injury/i)).toBeTruthy()
    expect(screen.queryByText(/^Tight$/)).toBeNull()
    expect(screen.queryByText(/^Weak$/)).toBeNull()
  })

  it('keeps the general reference view separate from supplied assessment mappings', () => {
    render(<MuscleModel3D findings={findings} referenceOnly />)
    expect(screen.getByRole('heading', { name: 'Explore anatomy in 3D' })).toBeTruthy()
    expect(screen.getByText(/No assessment findings are mapped/)).toBeTruthy()
    expect(screen.queryByLabelText('3D model legend')).toBeNull()
    expect(screen.getByText(/not a reconstruction of the captured person/)).toBeTruthy()
  })

  it('mounts the large viewer only after the explicit action', () => {
    render(<MuscleModel3D findings={findings} />)
    expect(screen.queryByTitle('Interactive 3D anatomy model')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open interactive 3d anatomy/i }))

    expect(screen.getByTitle('Interactive 3D anatomy model').getAttribute('src')).toBe(
      '/muscle-viewer/index.html?embed=1&legend=0',
    )
    expect(screen.getByRole('status').textContent).toContain('Loading interactive anatomy')
  })

  it('keeps the host loading after command readiness until model geometry renders', () => {
    render(<MuscleModel3D findings={findings} />)
    fireEvent.click(screen.getByRole('button', { name: /open interactive 3d anatomy/i }))
    const frame = screen.getByTitle('Interactive 3D anatomy model') as HTMLIFrameElement

    fireEvent(window, new MessageEvent('message', {
      data: { source: 'muscle-viewer', type: 'ready' },
      origin: window.location.origin,
      source: frame.contentWindow,
    }))
    expect(screen.getByRole('status').textContent).toContain('Loading interactive anatomy')

    fireEvent(window, new MessageEvent('message', {
      data: { source: 'muscle-viewer', type: 'model-ready' },
      origin: window.location.origin,
      source: frame.contentWindow,
    }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('surfaces an authoritative model-unavailable event', () => {
    render(<MuscleModel3D findings={findings} />)
    fireEvent.click(screen.getByRole('button', { name: /open interactive 3d anatomy/i }))
    const frame = screen.getByTitle('Interactive 3D anatomy model') as HTMLIFrameElement

    fireEvent(window, new MessageEvent('message', {
      data: { source: 'muscle-viewer', type: 'model-unavailable' },
      origin: window.location.origin,
      source: frame.contentWindow,
    }))
    expect(screen.getByRole('alert').textContent).toContain('did not load')
  })
})
