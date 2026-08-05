'use client'
import Image from 'next/image'
import { useMemo, useState } from 'react'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { tint, tone } from '@/components/array/severity'
import PointScanBody from './PointScanBody'
import { buildScanView, viewsWithMarkers, type ScanFindingInput, type ScanView } from './scanMarkers'
import styles from './AssessmentReview.module.css'

const SCAN_CAPTION =
  'Schematic only — markers show regions of interest, not literal anatomy. '
  + 'A 2D screening cannot locate a landmark precisely enough for one.'

export interface EvidenceCapture {
  id: string
  view: string
  profile_side: 'left' | 'right' | null
  signed_url: string | null
  capture_roll_deg: number | null
}

export default function ReviewEvidence({
  findings,
  captures,
  levelVerified,
}: {
  findings: readonly ScanFindingInput[]
  captures: readonly EvidenceCapture[]
  levelVerified: boolean | null
}) {
  const available = useMemo(() => viewsWithMarkers(findings), [findings])
  const [view, setView] = useState<ScanView>(() => available[0] ?? 'side')
  const scan = useMemo(() => buildScanView(findings, view), [findings, view])

  const unplaceable = findings.filter(finding => finding.zone !== 'unreliable').length
    - (buildScanView(findings, 'side').rows.length + buildScanView(findings, 'front').rows.length)

  return (
    <div className="app-stack">
      <Surface tier="feature">
        <PointScanBody
          view={view}
          onViewChange={setView}
          markers={scan.markers}
          caption={SCAN_CAPTION}
        />

        {scan.empty ? (
          <p className={styles.emptyState} style={{ marginTop: 14 }}>
            No findings from this screening can be placed on the {view} view.
            {available.length > 0 && !available.includes(view)
              ? ` Switch to the ${available[0]} view to see the ones that can.`
              : ''}
          </p>
        ) : (
          <div className="app-stack" style={{ marginTop: 14 }}>
            {scan.rows.map(row => (
              <div key={row.number} className={styles.zoneRow}>
                <span
                  className={`${styles.zoneNumber} n`}
                  style={{ background: tone(row.band) }}
                  aria-hidden="true"
                >
                  {row.number}
                </span>
                <span className={styles.zoneBody}>
                  <span className={styles.zoneName} style={{ display: 'block' }}>{row.name}</span>
                  <span className={styles.zoneMeta} style={{ display: 'block' }}>{row.region}</span>
                </span>
                <span className="n" style={{ color: tone(row.band), flexShrink: 0, fontWeight: 500 }}>
                  {row.severity.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}

        {unplaceable > 0 ? (
          <p className={styles.scanCaption}>
            {unplaceable === 1
              ? 'One further finding has no position on either view and is listed under Findings only.'
              : `${unplaceable} further findings have no position on either view and are listed under Findings only.`}
          </p>
        ) : null}
      </Surface>

      <Surface tier="tile">
        <div className={styles.captureHead}>
          <h3 className="t-title">Capture set</h3>
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

        {captures.length === 0 ? (
          <p className={styles.emptyState}>No captures are stored for this screening.</p>
        ) : (
          <div className={styles.captureGrid}>
            {captures.map(capture => {
              const label = capture.profile_side
                ? `${capture.view} ${capture.profile_side}`
                : capture.view
              // Roll is the recorded device tilt. A capture with none was not
              // measured for level, which is not the same as being level.
              const rolled = capture.capture_roll_deg !== null
                && Math.abs(capture.capture_roll_deg) > 3
              return (
                <div key={capture.id} className={styles.captureTile}>
                  <div className={styles.captureFrame}>
                    {capture.signed_url ? (
                      <Image
                        src={capture.signed_url}
                        alt={`${label} capture`}
                        className={styles.captureImage}
                        width={132}
                        height={176}
                        unoptimized
                      />
                    ) : (
                      <Icon name="user-linear" size={22} />
                    )}
                    <span className={styles.captureBadge} aria-hidden="true">
                      <Icon
                        name={rolled ? 'flag-linear' : 'check-circle-bold'}
                        size={14}
                      />
                    </span>
                  </div>
                  <span className={styles.captureLabel}>
                    {label}
                    {rolled ? ` · ${capture.capture_roll_deg?.toFixed(0)}° roll` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Surface>
    </div>
  )
}
