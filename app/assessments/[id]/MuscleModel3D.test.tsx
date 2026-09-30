// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MuscleModel3D, { type FindingOption } from './MuscleModel3D'
import type { AssessmentFinding } from './findingsToMuscleStates'

const forwardHead: AssessmentFinding = {
  zone: 'warning',
  severity_pct: 72,
  imbalance_key: 'forward_head_posture',
  tight_muscle_links: [{ slug: 'suboccipitals', name: 'Suboccipitals', confidence: 'high' }],
  weak_muscle_links: [{ slug: 'deep-cervical-flexors', name: 'Deep cervical flexors', confidence: 'high' }],
}
const pelvis: AssessmentFinding = {
  zone: 'warning',
  severity_pct: 60,
  imbalance_key: 'pelvic_obliquity',
  direction: 'Left Low',
  weak_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'elevated' }],
  tight_muscle_links: [{ slug: 'gluteus-medius', name: 'Gluteus medius', side: 'lowered' }],
}
const findings = [forwardHead, pelvis]
const options: FindingOption[] = [
  { key: 'forward_head_posture', label: 'Forward Head Posture', zoneLabel: 'Monitor', band: 'monitor', finding: forwardHead },
  { key: 'pelvic_obliquity', label: 'Pelvic Obliquity', zoneLabel: 'Monitor', band: 'monitor', finding: pelvis },
]

function viewerSays(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  fireEvent(window, new MessageEvent('message', {
    data: { source: 'muscle-viewer', ...data },
    origin: window.location.origin,
    source: frame.contentWindow,
  }))
}
const frameEl = () => screen.getByTitle('Interactive 3D anatomy model') as HTMLIFrameElement
const posted = (spy: ReturnType<typeof vi.spyOn>, type: string) =>
  spy.mock.calls.map((c) => c[0] as { type: string }).filter((m) => m.type === type)

beforeEach(() => {
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

describe('MuscleModel3D (posture map workspace)', () => {
  it('keeps the model uncovered: controls, findings and legend live outside the 3D frame', () => {
    render(<MuscleModel3D findings={findings} findingOptions={options} />)
    const frame = frameEl()
    expect(frame.getAttribute('src')).toBe('/muscle-viewer/index.html?embed=1&legend=0&card=0&controls=0')
    const toolbar = screen.getByRole('toolbar', { name: '3D view controls' })
    const strip = screen.getByRole('group', { name: 'Findings' })
    expect(frame.parentElement!.contains(toolbar)).toBe(false)
    expect(frame.parentElement!.contains(strip)).toBe(false)
    expect(screen.getByLabelText('3D model legend').textContent).toMatch(/Tight.*Weak.*Screening indication/)
  })

  it('enables Front/Back/Reset/X-ray once the model renders and drives the viewer with them', () => {
    render(<MuscleModel3D findings={findings} findingOptions={options} />)
    const frame = frameEl()
    const front = screen.getByRole('button', { name: 'Front' }) as HTMLButtonElement
    expect(front.disabled).toBe(true)
    viewerSays(frame, { type: 'model-ready' })
    expect(front.disabled).toBe(false)
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.change(screen.getByLabelText('X-ray depth'), { target: { value: '60' } })
    expect(posted(post, 'view')[0]).toMatchObject({ direction: 'back' })
    expect(posted(post, 'reset')).toHaveLength(1)
    expect(posted(post, 'setXray')[0]).toMatchObject({ value: 0.6 })
  })

  it('paints per-side states and sends the findings as the viewer rail groups', () => {
    render(<MuscleModel3D findings={findings} findingOptions={options} spotlightKey="pelvic_obliquity" />)
    const frame = frameEl()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    viewerSays(frame, { type: 'model-ready' })
    expect(posted(post, 'applyMuscleStates').at(-1)).toMatchObject({
      states: expect.arrayContaining([
        expect.objectContaining({ slug: 'gluteus-medius', role: 'weak', side: 'right' }),
        expect.objectContaining({ slug: 'gluteus-medius', role: 'tight', side: 'left' }),
      ]),
    })
    const groups = posted(post, 'groups').at(-1) as unknown as { groups: Array<{ id: string; muscles: string[] }>; active: string }
    expect(groups.active).toBe('pelvic_obliquity')
    expect(groups.groups.map((g) => g.id)).toEqual(['forward_head_posture', 'pelvic_obliquity'])
    expect(groups.groups[0].muscles).toEqual(['suboccipitals', 'deep_cervical_flexors'])
  })

  it('spotlights from the findings strip and from the viewer rail', () => {
    const onSpotlight = vi.fn()
    render(<MuscleModel3D findings={findings} findingOptions={options} onSpotlight={onSpotlight} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forward Head Posture, Monitor' }))
    expect(onSpotlight).toHaveBeenLastCalledWith('forward_head_posture')
    viewerSays(frameEl(), { type: 'group-select', id: 'pelvic_obliquity' })
    expect(onSpotlight).toHaveBeenLastCalledWith('pelvic_obliquity')
  })

  it('lists a spotlighted finding’s muscles; a chip isolates the muscle without opening details', () => {
    const onSelectMuscle = vi.fn()
    const onOpenDetails = vi.fn()
    render(
      <MuscleModel3D
        findings={findings}
        findingOptions={options}
        spotlightKey="forward_head_posture"
        onSelectMuscle={onSelectMuscle}
        onOpenDetails={onOpenDetails}
      />,
    )
    const group = screen.getByRole('group', { name: 'Forward Head Posture muscles' })
    fireEvent.click(group.querySelectorAll('button')[1])
    expect(onSelectMuscle).toHaveBeenCalledWith('deep_cervical_flexors', null)
    expect(onOpenDetails).not.toHaveBeenCalled()
  })

  it('shows the isolated muscle in an info bar; Details opens the sheet, ✕ clears it', () => {
    const onSelectMuscle = vi.fn()
    const onOpenDetails = vi.fn()
    render(
      <MuscleModel3D
        findings={findings}
        findingOptions={options}
        selectedMuscle="gluteus_medius"
        onSelectMuscle={onSelectMuscle}
        onOpenDetails={onOpenDetails}
      />,
    )
    const bar = screen.getByRole('status', { name: 'Selected muscle' })
    expect(bar.textContent).toContain('Gluteus medius')
    expect(bar.textContent).toContain('Right weak, left tight')
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(onOpenDetails).toHaveBeenCalledWith('gluteus_medius')
    fireEvent.click(screen.getByRole('button', { name: 'Clear muscle selection' }))
    expect(onSelectMuscle).toHaveBeenCalledWith(null, null)
  })

  it('reports user picks on the model, ignores echoes of its own commands, and forwards selection', () => {
    const onSelectMuscle = vi.fn()
    const { rerender } = render(<MuscleModel3D findings={findings} findingOptions={options} onSelectMuscle={onSelectMuscle} />)
    const frame = frameEl()
    viewerSays(frame, { type: 'selection', muscle: 'gluteus_medius', side: 'right', origin: 'user' })
    expect(onSelectMuscle).toHaveBeenCalledWith('gluteus_medius', 'right')
    onSelectMuscle.mockClear()
    viewerSays(frame, { type: 'selection', muscle: null, side: null, origin: 'host' })
    expect(onSelectMuscle).not.toHaveBeenCalled()

    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    act(() => {
      rerender(<MuscleModel3D findings={findings} findingOptions={options} onSelectMuscle={onSelectMuscle} selectedMuscle="rhomboids" />)
    })
    expect(posted(post, 'select').at(-1)).toMatchObject({ muscle: 'rhomboids' })
  })

  it('surfaces an authoritative model-unavailable event with a retry', () => {
    render(<MuscleModel3D findings={findings} findingOptions={options} />)
    viewerSays(frameEl(), { type: 'model-unavailable' })
    expect(screen.getByRole('alert').textContent).toContain('did not load')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('keeps reference-only anatomy an explicit tap, with no findings or legend', () => {
    render(<MuscleModel3D findings={findings} referenceOnly />)
    expect(screen.getByRole('heading', { name: 'Explore anatomy in 3D' })).toBeTruthy()
    expect(screen.queryByLabelText('3D model legend')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Findings' })).toBeNull()
    expect(screen.queryByTitle('Interactive 3D anatomy model')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /open interactive 3d anatomy/i }))
    expect(frameEl()).toBeTruthy()
  })
})
