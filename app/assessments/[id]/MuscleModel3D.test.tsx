// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MuscleModel3D from './MuscleModel3D'
import type { AssessmentFinding } from './findingsToMuscleStates'

const findings: AssessmentFinding[] = [
  {
    zone: 'warning',
    severity_pct: 72,
    imbalance_key: 'forward_head_posture',
    tight_muscle_links: [{ slug: 'suboccipitals', name: 'Suboccipitals', confidence: 'high' }],
    weak_muscle_links: [{ slug: 'deep-cervical-flexors', name: 'Deep cervical flexors', confidence: 'high' }],
  },
  {
    zone: 'warning',
    severity_pct: 60,
    imbalance_key: 'pelvic_obliquity',
    direction: 'Left Low',
    weak_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'elevated' }],
    tight_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'lowered' }],
  },
]

function viewerSays(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  fireEvent(window, new MessageEvent('message', {
    data: { source: 'muscle-viewer', ...data },
    origin: window.location.origin,
    source: frame.contentWindow,
  }))
}

function mountedFrame() {
  return screen.getByTitle('Interactive 3D anatomy model') as HTMLIFrameElement
}

beforeEach(() => {
  // Run the idle-time mount immediately.
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    cb()
    return 1
  })
  vi.stubGlobal('cancelIdleCallback', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MuscleModel3D (hero posture map)', () => {
  it('presents a tight/weak legend and the screening boundary', () => {
    render(<MuscleModel3D findings={findings} />)
    expect(screen.getByRole('heading', { name: 'Posture map' })).toBeTruthy()
    const legend = screen.getByLabelText('3D model legend')
    expect(legend.textContent).toContain('Tight')
    expect(legend.textContent).toContain('Weak')
    expect(screen.getByText(/Screening indication, not a diagnosis/)).toBeTruthy()
  })

  it('mounts the live model once the page is idle, with the viewer card disabled', () => {
    render(<MuscleModel3D findings={findings} />)
    expect(mountedFrame().getAttribute('src')).toBe('/muscle-viewer/index.html?embed=1&legend=0&card=0')
    expect(screen.getByRole('status').textContent).toContain('Loading your posture map')
  })

  it('waits for rendered geometry, then paints per-side states', () => {
    render(<MuscleModel3D findings={findings} />)
    const frame = mountedFrame()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')

    viewerSays(frame, { type: 'ready' })
    expect(screen.getByRole('status')).toBeTruthy()

    viewerSays(frame, { type: 'model-ready' })
    expect(screen.queryByRole('status')).toBeNull()
    const states = post.mock.calls.map((c) => c[0]).findLast((m) => m.type === 'applyMuscleStates')?.states
    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'suboccipitals', role: 'tight' }),
      expect.objectContaining({ slug: 'gluteus-medius', role: 'weak', side: 'right' }),
      expect.objectContaining({ slug: 'gluteus-medius', role: 'tight', side: 'left' }),
    ]))
    expect(post.mock.calls.map((c) => c[0]).findLast((m) => m.type === 'highlight')?.muscles).toBeNull()
  })

  it('surfaces an authoritative model-unavailable event with a retry', () => {
    render(<MuscleModel3D findings={findings} />)
    viewerSays(mountedFrame(), { type: 'model-unavailable' })
    expect(screen.getByRole('alert').textContent).toContain('did not load')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('spotlights one finding: highlights its muscles and lists them as chips', () => {
    const onSelectMuscle = vi.fn()
    const { rerender } = render(<MuscleModel3D findings={findings} onSelectMuscle={onSelectMuscle} />)
    const frame = mountedFrame()
    viewerSays(frame, { type: 'model-ready' })
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')

    rerender(
      <MuscleModel3D
        findings={findings}
        spotlight={{ label: 'Forward head posture', finding: findings[0] }}
        onSelectMuscle={onSelectMuscle}
      />,
    )
    expect(post).toHaveBeenCalledWith(
      { source: 'posture-ai', type: 'highlight', muscles: ['suboccipitals', 'deep_cervical_flexors'] },
      window.location.origin,
    )
    const group = screen.getByRole('group', { name: 'Forward head posture muscles' })
    expect(group.textContent).toContain('Suboccipitals')
    fireEvent.click(screen.getByRole('button', { name: /Deep cervical flexors/ }))
    expect(onSelectMuscle).toHaveBeenCalledWith('deep_cervical_flexors', null)
  })

  it('reports taps on the model and forwards the page selection to the viewer', () => {
    const onSelectMuscle = vi.fn()
    const { rerender } = render(<MuscleModel3D findings={findings} onSelectMuscle={onSelectMuscle} />)
    const frame = mountedFrame()
    viewerSays(frame, { type: 'selection', muscle: 'gluteus_medius', side: 'right' })
    expect(onSelectMuscle).toHaveBeenCalledWith('gluteus_medius', 'right')

    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() => {
      rerender(<MuscleModel3D findings={findings} onSelectMuscle={onSelectMuscle} selectedMuscle="rhomboids" />)
    })
    expect(post).toHaveBeenCalledWith({ source: 'posture-ai', type: 'select', muscle: 'rhomboids' }, window.location.origin)
  })

  it('keeps reference-only anatomy an explicit tap, with no assessment legend', () => {
    render(<MuscleModel3D findings={findings} referenceOnly />)
    expect(screen.getByRole('heading', { name: 'Explore anatomy in 3D' })).toBeTruthy()
    expect(screen.queryByLabelText('3D model legend')).toBeNull()
    expect(screen.queryByTitle('Interactive 3D anatomy model')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /open interactive 3d anatomy/i }))
    expect(mountedFrame()).toBeTruthy()
    expect(screen.getByText(/not a reconstruction of the captured person/)).toBeTruthy()
  })
})
