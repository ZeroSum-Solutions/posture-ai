'use client'
import CapturePhoto from './CapturePhoto'
import type { EvidenceCapture } from './ReviewEvidence'
import styles from './Results.module.css'

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

export function capturedCount(captures: readonly EvidenceCapture[]): number {
  return SLOTS.filter((slot) => captures.find(slot.match)?.signed_url).length
}

/**
 * The capture set as a 2×2 contact sheet — "Photos (n of 4)" — with a missing
 * slot shown in place. Lives in the capture-quality sheet with the accuracy
 * notes: both answer "how good was this capture?".
 */
export function CaptureSet({ captures }: { captures: readonly EvidenceCapture[] }) {
  const tiles = SLOTS.map((slot) => ({ slot, capture: captures.find(slot.match) ?? null }))
  return (
    <section className={styles.sheetSection}>
      <h3 className="t-micro">Photos ({capturedCount(captures)} of {SLOTS.length})</h3>
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
    </section>
  )
}

