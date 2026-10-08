'use client'
import ReviewFindings from './ReviewFindings'
import type { ReviewFindingRow } from './reviewModel'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'

export interface EvidenceCapture {
  id: string
  view: string
  profile_side: 'left' | 'right' | null
  signed_url: string | null
  capture_roll_deg: number | null
}

/**
 * The Findings pane: filter tiles and one readout per finding (ReviewFindings).
 * Every finding is listed, worst first, with the view it was measured on.
 */
export default function ReviewEvidence({
  rows,
  viewByKey,
  program,
  activeKey = null,
  onSpotlight,
  thresholdsApply = false,
}: {
  rows: readonly ReviewFindingRow[]
  /** The view each finding was measured on, by imbalance key. */
  viewByKey: Readonly<Record<string, string>>
  program?: ClinicalProgramReport | null
  activeKey?: string | null
  onSpotlight?: (key: string) => void
  thresholdsApply?: boolean
}) {
  return (
    <ReviewFindings
      rows={rows}
      viewByKey={viewByKey}
      program={program}
      activeKey={activeKey}
      onSpotlight={onSpotlight}
      thresholdsApply={thresholdsApply}
    />
  )
}
