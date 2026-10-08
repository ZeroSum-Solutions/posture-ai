'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { bandFromZone } from '@/components/array/severity'
import { FindingMatrix, Sheet, SeverityChip, type MatrixCell } from '@/components/ui'
import { buildFindingsTrend, type FindingsTrendAssessment } from './findingsModel'
import { formatClientDate } from './clientDate'
import styles from './ClientDetail.module.css'

type CellBand = 'maintain' | 'monitor' | 'review' | 'neutral'

function cellBand(zone: string | null): CellBand {
  const band = bandFromZone(zone)
  return band === 'maintain' || band === 'monitor' || band === 'review' ? band : 'neutral'
}

function severityOf(value: number | string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Findings over time (docs/design/array-v4-dataviz.md § H): one row per
 * finding, one column per recent scan, newest first; each cell is the band
 * word + beads, `—` where there is no reading. Tapping a cell opens that
 * reading: recorded severity, date, scoring version and the scan itself.
 * Unreliable readings show as "Not scored", never as a band.
 */
export default function FindingHistory({
  assessments,
  maxScans = 4,
  maxFindings,
  caption = 'Findings across recent scans',
}: {
  /** Chronological, oldest first. */
  assessments: readonly FindingsTrendAssessment[]
  maxScans?: number
  /** Limit to the worst findings of the latest scan. */
  maxFindings?: number
  caption?: string
}) {
  const [open, setOpen] = useState<{ key: string; scanId: string } | null>(null)

  const { findings, scans, cells, readings } = useMemo(() => {
    const recent = [...assessments].reverse().slice(0, maxScans)
    const series = buildFindingsTrend(assessments).filter((entry) => entry.latest !== null)
    const rows = (maxFindings ? series.slice(0, maxFindings) : series).map((entry) => ({ key: entry.key, name: entry.label }))
    const grid: Record<string, Record<string, MatrixCell>> = {}
    const detail: Record<string, Record<string, { severity: number | null; band: CellBand }>> = {}
    for (const row of rows) {
      grid[row.key] = {}
      detail[row.key] = {}
      for (const scan of recent) {
        const finding = scan.findings.find((candidate) => candidate.key === row.key)
        if (!finding) { grid[row.key][scan.id] = null; continue }
        const reliable = finding.zone !== null && finding.zone !== 'unreliable'
        const severity = reliable ? severityOf(finding.severityPct) : null
        const band = reliable ? cellBand(finding.zone) : 'neutral'
        grid[row.key][scan.id] = { band, value: severity === null ? 'no reliable reading' : `${severity.toFixed(1)}% recorded severity` }
        detail[row.key][scan.id] = { severity, band }
      }
    }
    return {
      findings: rows,
      scans: recent.map((scan) => ({ id: scan.id, label: formatClientDate(scan.assessedAt, 'day-month-short-no-year') })),
      cells: grid,
      readings: detail,
    }
  }, [assessments, maxScans, maxFindings])

  if (findings.length === 0) {
    return <p className={styles.emptyState}>No reliable findings are recorded yet.</p>
  }

  const openFinding = open ? findings.find((finding) => finding.key === open.key) : null
  const openScan = open ? assessments.find((scan) => scan.id === open.scanId) : null
  const openReading = open ? readings[open.key]?.[open.scanId] : null

  return (
    <>
      <FindingMatrix
        findings={findings}
        scans={scans}
        cells={cells}
        caption={caption}
        onCell={(key, scanId) => setOpen({ key, scanId })}
      />
      <Sheet
        open={open !== null}
        onOpenChange={(next) => { if (!next) setOpen(null) }}
        title={openFinding?.name ?? 'Finding'}
        detents={['compact']}
      >
        {openScan && openReading ? (
          <div className={styles.cellSheet}>
            <p className="t-micro">{formatClientDate(openScan.assessedAt, 'day-month-long')}</p>
            <div className={styles.cellReading}>
              <span className={styles.cellValue}>
                {openReading.severity === null ? '—' : <><span className="n">{openReading.severity.toFixed(1)}</span><span className={styles.cellUnit}>%</span></>}
              </span>
              <SeverityChip band={openReading.band} />
            </div>
            <p className="t-label">
              {openReading.severity === null ? 'No reliable reading for this scan.' : 'Recorded severity, 0–100%. Lower is less deviation.'}
              {' '}Scoring version {openScan.scoringEngineVersion ?? 'unknown — not comparable'}.
            </p>
            <Link href={`/assessments/${openScan.id}`} className={styles.heroLink} prefetch={false}>
              Open scan
              <Icon name="alt-arrow-right-linear" size={16} />
            </Link>
          </div>
        ) : null}
      </Sheet>
    </>
  )
}
