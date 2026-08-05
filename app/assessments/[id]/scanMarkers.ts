import { bandFromZone, type SeverityBand } from '@/components/array/severity'
import type { ScanMarker } from './PointScanBody'

/**
 * Which findings a body view can show, and where down the figure each one sits.
 *
 * These positions moved here from the skeletal diagram they used to annotate.
 * They are schematic anchors — "roughly the cervical region" — not anatomical
 * landmarks, and the caption on the scan says so. A finding with no position in a
 * view is not drawn in that view rather than being placed at a guessed height:
 * an unplaced marker pointing at the wrong region is worse than an absent one.
 *
 * `at` is a fraction of body height, crown (0) to feet (1).
 */

export type ScanView = 'side' | 'front'

interface MarkerAnchor {
  at: number
  region: string
}

const SIDE_ANCHORS: Record<string, MarkerAnchor> = {
  forward_head_posture: { at: 0.085, region: 'Cervical' },
  t1_tilt_backward: { at: 0.35, region: 'Upper thoracic' },
  trunk_lean: { at: 0.35, region: 'Trunk' },
  anterior_pelvic_shift: { at: 0.667, region: 'Pelvis' },
  knee_extension_back_knee: { at: 0.924, region: 'Knee' },
}

const FRONT_ANCHORS: Record<string, MarkerAnchor> = {
  anterior_imbalanced_shoulders: { at: 0.188, region: 'Shoulders' },
  posterior_imbalanced_shoulders: { at: 0.188, region: 'Shoulders' },
  pelvic_obliquity: { at: 0.661, region: 'Pelvis' },
  genu_varum_valgum_left: { at: 0.924, region: 'Left knee' },
  genu_varum_valgum_right: { at: 0.924, region: 'Right knee' },
}

export interface ScanFindingInput {
  imbalance_key: string
  label: string
  zone: 'maintain' | 'warning' | 'danger' | 'unreliable'
  severity_pct: number
}

export interface ScanZoneRow {
  number: number
  name: string
  region: string
  band: SeverityBand
  severity: number
}

export interface ScanViewModel {
  markers: ScanMarker[]
  rows: ScanZoneRow[]
  /** True when this view has nothing plottable, so the caller can say why. */
  empty: boolean
}

function anchorsFor(view: ScanView): Record<string, MarkerAnchor> {
  return view === 'side' ? SIDE_ANCHORS : FRONT_ANCHORS
}

/** Which views can show at least one of these findings. */
export function viewsWithMarkers(findings: readonly ScanFindingInput[]): ScanView[] {
  return (['side', 'front'] as const).filter(view => {
    const anchors = anchorsFor(view)
    return findings.some(finding => (
      finding.zone !== 'unreliable' && anchors[finding.imbalance_key] !== undefined
    ))
  })
}

/**
 * Markers and their numbered rows for one view, worst first.
 *
 * Unusable readings are excluded: a marker asserts a position on the body and a
 * severity colour, and an unreliable measurement supports neither. They are
 * counted elsewhere on the screen so they are never silently dropped.
 */
export function buildScanView(
  findings: readonly ScanFindingInput[],
  view: ScanView,
): ScanViewModel {
  const anchors = anchorsFor(view)
  const plottable = findings
    .filter(finding => finding.zone !== 'unreliable' && anchors[finding.imbalance_key] !== undefined)
    .sort((left, right) => (
      right.severity_pct - left.severity_pct || left.label.localeCompare(right.label)
    ))

  const markers: ScanMarker[] = []
  const rows: ScanZoneRow[] = []

  plottable.forEach((finding, index) => {
    const anchor = anchors[finding.imbalance_key]
    const band = bandFromZone(finding.zone)
    const number = index + 1
    markers.push({ number, at: anchor.at, band, label: finding.label })
    rows.push({
      number,
      name: finding.label,
      region: anchor.region,
      band,
      severity: finding.severity_pct,
    })
  })

  return { markers, rows, empty: plottable.length === 0 }
}
