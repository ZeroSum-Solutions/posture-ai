'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { tint, tone } from '@/components/array/severity'
import CapturePhoto from './CapturePhoto'
import ReviewFindings from './ReviewFindings'
import type { ReviewFindingRow } from './reviewModel'
import styles from './AssessmentReview.module.css'

export interface EvidenceCapture {
  id: string
  view: string
  profile_side: 'left' | 'right' | null
  signed_url: string | null
  capture_roll_deg: number | null
}

const VIEW_ORDER = ['front', 'side', 'back']
const VIEW_NAME: Record<string, string> = { front: 'Front', side: 'Side', back: 'Back' }

function viewName(view: string): string {
  return VIEW_NAME[view] ?? view.charAt(0).toUpperCase() + view.slice(1)
}

function viewRank(view: string): number {
  const index = VIEW_ORDER.indexOf(view)
  return index === -1 ? VIEW_ORDER.length : index
}

/**
 * The capture set is the evidence: every saved photo, in view order. Tapping a photo selects
 * its view — that view's photos take a highlighted border — and the findings measured on it
 * list right below (unusable readings included, flagged for re-capture). Each finding belongs
 * to the one view it was measured on, so stepping through the views covers the whole screening.
 */
export default function ReviewEvidence({
  rows,
  viewByKey,
  captures,
  levelVerified,
  activeKey = null,
  onSpotlight,
}: {
  rows: readonly ReviewFindingRow[]
  /** The view each finding was measured on, by imbalance key. */
  viewByKey: Readonly<Record<string, string>>
  captures: readonly EvidenceCapture[]
  levelVerified: boolean | null
  activeKey?: string | null
  onSpotlight?: (key: string) => void
}) {
  // Every view that has a photo or a finding, front → side → back. A view with findings but no
  // saved photo still gets a tile, so its findings stay reachable.
  const tiles = useMemo(() => {
    const photoViews = new Set(captures.map(capture => capture.view))
    const orphanViews = [...new Set(rows.map(row => viewByKey[row.key]).filter(Boolean))]
      .filter(view => !photoViews.has(view))
    return [
      ...captures.map(capture => ({ key: capture.id, view: capture.view, capture })),
      ...orphanViews.map(view => ({ key: `view-${view}`, view, capture: null })),
    ].sort((left, right) => viewRank(left.view) - viewRank(right.view))
  }, [captures, rows, viewByKey])

  const rowsFor = (view: string) => rows.filter(row => viewByKey[row.key] === view)
  const [view, setView] = useState<string | null>(
    () => tiles.find(tile => rowsFor(tile.view).length > 0)?.view ?? tiles[0]?.view ?? null,
  )
  const viewRows = view ? rowsFor(view) : []

  return (
    <div className="app-stack">
      <Surface tier="feature">
        <div className={styles.captureHead}>
          <h3 className="t-headline">Capture set</h3>
          {levelVerified === true ? (
            <span
              className={styles.verifiedChip}
              style={{ background: tint('maintain'), color: tone('maintain') }}
            >
              <Icon name="shield-check-linear" size={13} />
              Level verified
            </span>
          ) : levelVerified === false ? (
            <span
              className={styles.verifiedChip}
              style={{ background: tint('monitor'), color: tone('monitor') }}
            >
              <Icon name="flag-linear" size={13} />
              Level not verified
            </span>
          ) : null}
        </div>

        {tiles.length === 0 ? (
          <p className={styles.emptyState}>No captures are stored for this screening.</p>
        ) : (
          <div className={styles.captureGrid} role="group" aria-label="Capture views">
            {tiles.map(({ key, view: tileView, capture }) => {
              const label = capture?.profile_side
                ? `${tileView} ${capture.profile_side}`
                : tileView
              // Roll is the recorded device tilt. A capture with none was not
              // measured for level, which is not the same as being level.
              const roll = capture?.capture_roll_deg ?? null
              const rolled = roll !== null && Math.abs(roll) > 3
              const selected = tileView === view
              return (
                <div key={key} className={styles.captureTile}>
                  <div
                    className={[styles.captureFrame, selected ? styles.captureFrameSelected : '']
                      .filter(Boolean).join(' ')}
                    data-view={tileView}
                  >
                    <CapturePhoto
                      key={capture?.signed_url ?? key}
                      url={capture?.signed_url ?? null}
                      label={label}
                      selected={selected}
                      onSelect={() => setView(tileView)}
                    />
                    {roll !== null ? <span className={styles.captureBadge} aria-hidden="true">
                      <Icon name={rolled ? 'flag-linear' : 'check-circle-bold'} size={14} />
                    </span> : null}
                  </div>
                  <span className={styles.captureLabel}>
                    {label}
                    {rolled ? ` · ${roll?.toFixed(0)}° roll` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Surface>

      {view && (
        <section className="app-stack" aria-labelledby="evidence-view-title" data-evidence-view={view}>
          <h3 id="evidence-view-title" className={styles.viewTitle}>
            {viewName(view)} view
            <span className="n">
              {viewRows.length === 1 ? '1 finding' : `${viewRows.length} findings`}
            </span>
          </h3>
          <ReviewFindings
            rows={viewRows}
            activeKey={activeKey}
            onSpotlight={onSpotlight}
            emptyText={`No findings were measured on the ${viewName(view).toLowerCase()} view.`}
          />
        </section>
      )}
    </div>
  )
}
