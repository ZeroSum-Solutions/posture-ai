'use client'

import Link from 'next/link'
import type { DemoScan } from '@/lib/demo/scan'
import { Surface } from '@/components/array/Surface'
import ScanVisual from './ScanVisual'
import styles from './ScanExperience.module.css'

const ZONE_LABEL = { maintain: 'In reference range', warning: 'Monitor', danger: 'Review', unreliable: 'Needs a clearer capture' }
const ZONE_COLOR = { maintain: 'var(--maintain)', warning: 'var(--monitor)', danger: 'var(--review)', unreliable: 'var(--text-secondary)' }

export default function ScanResults({ scan, images, onReset }: {
  scan: DemoScan
  images: Partial<Record<'front' | 'side', string>>
  onReset: () => void
}) {
  const findings = [...scan.result.findings].sort((a, b) => Number(b.reliable) - Number(a.reliable) || b.severityPct - a.severityPct)
  const flagged = findings.filter(finding => finding.reliable && finding.zone !== 'maintain').length
  return (
    <div className={styles.stack}>
      <Surface tier="feature" innerClassName={styles.stack}>
        <span className={styles.tag}>{scan.source === 'sample' ? 'Synthetic sample · Alex' : 'Your browser-only scan'}</span>
        <div className={styles.score}>
          <div>
            <h2 className="t-headline-sm">Your starting point.</h2>
            <p className={styles.muted}>{flagged} {flagged === 1 ? 'area' : 'areas'} to explore · Grade {scan.result.overallGrade}</p>
          </div>
          <div className={`${styles.scoreValue} n`}>{Math.round(scan.result.overallScore)}<small>/100</small></div>
        </div>
        <p className={styles.muted}>Alignment score · higher is closer to the screening reference. Use this snapshot to explore movement. It is not a medical diagnosis.</p>
        <div className={styles.views}>
          {scan.frames.filter(frame => frame.view === 'front' || frame.view === 'side').map(frame => (
            <ScanVisual key={frame.view} frame={frame} image={images[frame.view as 'front' | 'side']} sample={scan.source === 'sample'} />
          ))}
        </div>
        <p className={styles.muted}>{scan.source === 'sample'
          ? 'One authored sample subject, shown in two views. Findings are calculated from these same sample coordinates every time.'
          : 'Photos stay in this page and are not uploaded or saved. Saved landmarks use the same uncropped coordinates as the photo overlay.'}</p>
        <Link href="/demo/workouts" className="a-primary a-primary--bar">Build a workout from this scan</Link>
      </Surface>
      <Surface tier="tile">
        <h2 className="t-title">What the scan found</h2>
        {findings.map(finding => (
          <div key={finding.key} className={styles.finding}>
            <div>
              <h3 className="t-title">{finding.label}</h3>
              <p className={styles.muted} style={{ color: ZONE_COLOR[finding.zone] }}>{ZONE_LABEL[finding.zone]} · {finding.viewUsed} view</p>
              {finding.reliable ? <p className={styles.muted}>{finding.direction}</p> : null}
            </div>
            <div className={`${styles.measurement} n`}>
              {finding.reliable ? `${Math.abs(finding.deviation).toFixed(1)}°` : '—'}
              <small>{finding.reliable ? `reference ${finding.standard}°` : 'Not scored'}</small>
            </div>
          </div>
        ))}
      </Surface>
      <p className={styles.notice}>{scan.result.missingViews.includes('back') ? 'Front and side screening. A back view was not captured. ' : ''}One image per view cannot establish repeatability. Camera level was not sensor verified.</p>
      <button type="button" className="a-secondary" onClick={onReset}>Start another scan</button>
    </div>
  )
}
