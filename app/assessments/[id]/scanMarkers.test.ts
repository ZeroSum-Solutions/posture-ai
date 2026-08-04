import { describe, expect, it } from 'vitest'
import { buildScanView, viewsWithMarkers, type ScanFindingInput } from './scanMarkers'

function finding(
  imbalance_key: string,
  severity_pct: number,
  zone: ScanFindingInput['zone'] = 'warning',
): ScanFindingInput {
  return { imbalance_key, label: `Label ${imbalance_key}`, zone, severity_pct }
}

describe('buildScanView', () => {
  it('numbers markers worst first and keeps rows in the same order', () => {
    const view = buildScanView([
      finding('forward_head_posture', 20),
      finding('anterior_pelvic_shift', 70),
      finding('trunk_lean', 45),
    ], 'side')
    expect(view.rows.map(row => row.name)).toEqual([
      'Label anterior_pelvic_shift', 'Label trunk_lean', 'Label forward_head_posture',
    ])
    expect(view.markers.map(marker => marker.number)).toEqual([1, 2, 3])
    expect(view.rows.map(row => row.number)).toEqual([1, 2, 3])
  })

  it('drops a finding this view cannot place rather than guessing a height', () => {
    const view = buildScanView([
      finding('pelvic_obliquity', 50),
      finding('forward_head_posture', 40),
    ], 'side')
    expect(view.rows.map(row => row.name)).toEqual(['Label forward_head_posture'])
  })

  it('excludes an unusable reading from the body scan', () => {
    const view = buildScanView([
      finding('forward_head_posture', 90, 'unreliable'),
      finding('trunk_lean', 30),
    ], 'side')
    expect(view.markers).toHaveLength(1)
    expect(view.rows[0].name).toBe('Label trunk_lean')
  })

  it('reports an empty view instead of drawing an unmarked body', () => {
    const view = buildScanView([finding('pelvic_obliquity', 50)], 'side')
    expect(view.empty).toBe(true)
    expect(view.markers).toHaveLength(0)
  })

  it('bands a marker from its zone', () => {
    const view = buildScanView([
      finding('forward_head_posture', 80, 'danger'),
      finding('trunk_lean', 20, 'maintain'),
    ], 'side')
    expect(view.markers[0].band).toBe('review')
    expect(view.markers[1].band).toBe('maintain')
  })

  it('keeps every marker inside the figure', () => {
    const view = buildScanView([
      finding('forward_head_posture', 10),
      finding('knee_extension_back_knee', 20),
    ], 'side')
    for (const marker of view.markers) {
      expect(marker.at).toBeGreaterThan(0)
      expect(marker.at).toBeLessThan(1)
    }
  })

  it('carries the region name so a row is readable without the drawing', () => {
    const view = buildScanView([finding('pelvic_obliquity', 50)], 'front')
    expect(view.rows[0].region).toBe('Pelvis')
  })
})

describe('viewsWithMarkers', () => {
  it('lists only the views that can show something', () => {
    expect(viewsWithMarkers([finding('forward_head_posture', 40)])).toEqual(['side'])
    expect(viewsWithMarkers([finding('pelvic_obliquity', 40)])).toEqual(['front'])
    expect(viewsWithMarkers([
      finding('forward_head_posture', 40),
      finding('pelvic_obliquity', 40),
    ])).toEqual(['side', 'front'])
  })

  it('returns nothing when every reading is unusable', () => {
    expect(viewsWithMarkers([finding('forward_head_posture', 40, 'unreliable')])).toEqual([])
  })
})
