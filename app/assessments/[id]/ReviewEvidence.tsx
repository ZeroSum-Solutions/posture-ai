'use client'
import { Disclosure } from '@/components/ui'
import CapturePhoto from './CapturePhoto'
import ReviewFindings from './ReviewFindings'
import type { ReviewFindingRow } from './reviewModel'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'
import styles from './Results.module.css'

export interface EvidenceCapture {
  id: string
  view: string
  profile_side: 'left' | 'right' | null
  signed_url: string | null
  capture_roll_deg: number | null
}

/** The four canonical capture slots (spec §5 Capture): front, left/right
 * profile and back. A slot with no matching capture renders as a missing
 * tile (CapturePhoto's own "No photo for this view" state) rather than
 * being silently dropped, so "Photos (n of 4)" always counts against 4. */
const SLOTS: { key: string; label: string; match: (c: EvidenceCapture) => boolean }[] = [
  { key: 'front', label: 'Front', match: (c) => c.view === 'front' },
  { key: 'side-left', label: 'Left Side', match: (c) => c.view === 'side' && c.profile_side === 'left' },
  { key: 'side-right', label: 'Right Side', match: (c) => c.view === 'side' && c.profile_side === 'right' },
  { key: 'back', label: 'Back', match: (c) => c.view === 'back' },
]

/**
 * The capture set — a Disclosure "Photos (n of 4)" — followed by the findings
 * list (ReviewFindings), grouped by severity rather than gated behind a
 * per-view toggle: every finding is listed, with the view it was measured on
 * as its subhead.
 */
export default function ReviewEvidence({
  rows,
  viewByKey,
  captures,
  program,
  levelVerified,
  activeKey = null,
  onSpotlight,
}: {
  rows: readonly ReviewFindingRow[]
  /** The view each finding was measured on, by imbalance key. */
  viewByKey: Readonly<Record<string, string>>
  captures: readonly EvidenceCapture[]
  program?: ClinicalProgramReport | null
  levelVerified: boolean | null
  activeKey?: string | null
  onSpotlight?: (key: string) => void
}) {
  const tiles = SLOTS.map((slot) => ({ slot, capture: captures.find(slot.match) ?? null }))
  const savedCount = tiles.filter((tile) => tile.capture?.signed_url).length

  return (
    <div className="app-stack">
      <Disclosure title={`Photos (${savedCount} of ${SLOTS.length})`}>
        <div className={styles.captureGrid} role="group" aria-label="Capture views">
          {tiles.map(({ slot, capture }) => {
            const roll = capture?.capture_roll_deg ?? null
            const rolled = roll !== null && Math.abs(roll) > 3
            return (
              <div key={slot.key} className={styles.captureTile}>
                <div className={styles.captureFrame}>
                  <CapturePhoto url={capture?.signed_url ?? null} label={slot.label} />
                </div>
                <span className={styles.captureLabel}>
                  {slot.label}
                  {rolled ? ` · ${roll?.toFixed(0)}° roll` : ''}
                </span>
              </div>
            )
          })}
        </div>
        {levelVerified === false && (
          <p className="t-footnote" style={{ color: 'var(--monitor)', marginTop: 'var(--s-12)' }}>
            Camera level not verified for this screening.
          </p>
        )}
      </Disclosure>

      <ReviewFindings
        rows={rows}
        viewByKey={viewByKey}
        program={program}
        activeKey={activeKey}
        onSpotlight={onSpotlight}
      />
    </div>
  )
}
