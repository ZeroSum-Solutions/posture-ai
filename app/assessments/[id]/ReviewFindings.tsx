'use client'
import { useState, type CSSProperties } from 'react'
import { THRESHOLDS } from '@posture-ai/engine/thresholds'
import {
  Button,
  EmptyState,
  FilterTiles,
  FindingReadout,
  Sheet,
  type FindingScale,
  type SeverityChipBand,
  type TileBand,
} from '@/components/ui'
import type { SeverityBand } from '@/components/array/severity'
import { hasAnyMuscle } from './muscleMap'
import type { ReviewFindingRow } from './reviewModel'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'
import styles from './Results.module.css'

function toChipBand(band: SeverityBand): SeverityChipBand {
  return band === 'maintain' || band === 'monitor' || band === 'review' ? band : 'neutral'
}

function viewLabel(view: string | undefined): string | undefined {
  if (!view) return undefined
  return view.charAt(0).toUpperCase() + view.slice(1)
}

/**
 * The view line for a finding, from the same record as its label. A metric
 * named for one view can be read from another photo: the engine measures
 * "Shoulder Imbalance (Back)" on the front photo when no back photo was taken,
 * and records `view_used: 'front'`. Say that plainly instead of printing a
 * bare "Front" beside a "(Back)" name.
 */
function viewMeta(label: string, view: string | undefined): string | undefined {
  if (!view || view === 'unknown') return undefined
  const named = /\((front|back|side)\)\s*$/i.exec(label)?.[1]?.toLowerCase()
  if (named && named !== view) return `Read from ${view} photo`
  return viewLabel(view)
}

/** The engine stores angles as `deg`; the screen prints the degree sign. */
function displayUnit(unit: string): string {
  return unit === 'deg' ? '°' : unit
}

/** Splits the pre-formatted "12.4deg" string back into a number + unit. */
function parseMeasurement(measurement: string | null): { value: number | null; unit: string } {
  if (!measurement) return { value: null, unit: '' }
  const match = measurement.match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  if (!match) return { value: null, unit: '' }
  return { value: Number(match[1]), unit: match[2] ?? '' }
}

/**
 * The threshold scale for one finding (dataviz § A): drawn only when the
 * engine's own degree cut-points describe this reading — the scan was scored
 * by the current engine (`thresholdsApply`), the reading is in degrees, and
 * the metric has published cut-points. Anything else shows the value alone.
 */
function scaleFor(key: string, unit: string, thresholdsApply: boolean): FindingScale | undefined {
  if (!thresholdsApply || unit !== 'deg') return undefined
  const threshold = THRESHOLDS[key]
  if (!threshold) return undefined
  return { warn: threshold.warn.deg, danger: threshold.danger.deg }
}

/** Only a comparable, non-zero difference earns space on the row; the sheet says the rest. */
function deltaMeta(row: ReviewFindingRow): string | null {
  return row.delta ? `severity ${row.delta} vs last scan` : null
}

/** Value + display unit straight from the recorded deviation (unit may be unrecorded). */
function readingOf(row: ReviewFindingRow): { value: number | null; unit: string; rawUnit: string } {
  if (row.reliable && row.deviation !== null) {
    const rawUnit = row.unit ?? ''
    return { value: row.deviation, unit: displayUnit(rawUnit), rawUnit }
  }
  const parsed = parseMeasurement(row.measurement)
  return { value: row.reliable ? parsed.value : null, unit: displayUnit(parsed.unit), rawUnit: parsed.unit }
}

/**
 * Findings in a scan (dataviz § A + § B): three filter tiles carry the count
 * per band — tap one to filter, tap again to clear — then one readout per
 * finding, worst first, as hairline rows. Each row opens its detail in a sheet
 * that grows from the row: the readout, why it was flagged, the muscles it
 * references (with "Show on map") and the exercises the program linked to it.
 */
export default function ReviewFindings({
  rows,
  viewByKey,
  program,
  activeKey = null,
  onSpotlight,
  thresholdsApply = false,
  emptyText = 'No findings were recorded for this screening.',
}: {
  rows: readonly ReviewFindingRow[]
  /** The view each finding was measured on, by imbalance key. */
  viewByKey?: Readonly<Record<string, string>>
  /** Used to look up exercises the program already assigned to this finding. */
  program?: ClinicalProgramReport | null
  /** The finding currently spotlighted on the 3D map. */
  activeKey?: string | null
  /** Spotlight (or clear, when already active) a finding's muscles on the 3D map. */
  onSpotlight?: (key: string) => void
  /** True when the scan was scored by the engine whose cut-points this build carries. */
  thresholdsApply?: boolean
  /** What to say when there are no rows. */
  emptyText?: string
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<TileBand | null>(null)
  const openRow = rows.find((row) => row.key === openKey) ?? null

  if (rows.length === 0) {
    return <EmptyState icon="check-circle-linear" variant="inline" title="No findings" body={emptyText} />
  }

  const counts: Record<TileBand, number> = { review: 0, monitor: 0, maintain: 0 }
  for (const row of rows) {
    if (row.band === 'review' || row.band === 'monitor' || row.band === 'maintain') counts[row.band] += 1
  }
  const visible = filter ? rows.filter((row) => row.band === filter) : rows

  return (
    <div className={styles.findings}>
      <FilterTiles counts={counts} selected={filter} onSelect={setFilter} />

      <ul className={styles.findingList} aria-label={filter ? `${filter} findings` : 'All findings'} key={filter ?? 'all'}>
        {visible.map((row, index) => {
          const { value, unit, rawUnit } = readingOf(row)
          const view = viewMeta(row.label, viewByKey?.[row.key])
          const delta = deltaMeta(row)
          const meta = [view, delta].filter(Boolean).join(' · ')
          return (
            <li key={row.id} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
              <button
                type="button"
                className={styles.findingButton}
                data-testid="finding-row"
                data-active={activeKey === row.key ? 'true' : undefined}
                onClick={() => setOpenKey(row.key)}
              >
                <FindingReadout
                  name={row.label}
                  value={value}
                  unit={unit}
                  band={toChipBand(row.band)}
                  scale={value !== null ? scaleFor(row.key, rawUnit, thresholdsApply) : undefined}
                  meta={meta || undefined}
                />
              </button>
            </li>
          )
        })}
      </ul>

      {openRow && (
        <FindingSheet
          row={openRow}
          view={viewByKey?.[openRow.key]}
          program={program}
          active={activeKey === openRow.key}
          thresholdsApply={thresholdsApply}
          onSpotlight={onSpotlight}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  )
}

function FindingSheet({
  row,
  view,
  program,
  active,
  thresholdsApply,
  onSpotlight,
  onClose,
}: {
  row: ReviewFindingRow
  view?: string
  program?: ClinicalProgramReport | null
  active: boolean
  thresholdsApply: boolean
  onSpotlight?: (key: string) => void
  onClose: () => void
}) {
  const { value, unit, rawUnit } = readingOf(row)
  const viewLine = viewMeta(row.label, view)
  const muscles = [
    ...row.tightLinks.map((muscle) => ({ ...muscle, role: 'tight' as const })),
    ...row.weakLinks.map((muscle) => ({ ...muscle, role: 'weak' as const })),
  ]
  const linkedExercises = program?.priorities.find((priority) => priority.primaryKey === row.key)?.steps ?? []
  const spotlightable = !!onSpotlight && hasAnyMuscle({
    tightMuscles: row.tightMuscles,
    weakMuscles: row.weakMuscles,
    tightLinks: row.tightLinks,
    weakLinks: row.weakLinks,
  })
  const reference = row.reference ? row.reference.replace(/^ref\s*/, '').replace(/deg$/, '°') : null

  return (
    <Sheet
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={row.label}
      detents={['medium', 'large']}
      data-testid={`finding-sheet-${row.key}`}
    >
      <div className={styles.sheetStack}>
        <FindingReadout
          name={!viewLine ? 'Recorded value' : viewLine === viewLabel(view) ? `${viewLine} view` : viewLine}
          value={value}
          unit={unit}
          band={toChipBand(row.band)}
          scale={value !== null ? scaleFor(row.key, rawUnit, thresholdsApply) : undefined}
          meta={[
            reference ? `Reference ${reference}` : null,
            row.deltaWord === 'not comparable' ? 'Not comparable with the previous scan' : row.delta ? `Severity ${row.delta} vs last scan` : null,
          ].filter(Boolean).join(' · ') || undefined}
        />

        {!row.reliable && (
          <p className={styles.sheetAlert}>Reading not usable — re-capture this view.</p>
        )}

        <section className={styles.sheetSection}>
          <h3 className="t-micro">Why this</h3>
          <p className="t-body">
            {row.causes ?? `${row.label} reads outside the ${row.zoneLabel.toLowerCase()} range for this screening.`}
          </p>
        </section>

        {muscles.length > 0 && (
          <section className={styles.sheetSection}>
            <h3 className="t-micro">Muscles involved</h3>
            <ul className={styles.muscleList}>
              {muscles.map((muscle) => (
                <li key={`${muscle.slug}-${muscle.role}`}>
                  <span className={styles.muscleName}>{muscle.name}</span>
                  <span className={styles.muscleRole} data-role={muscle.role}>{muscle.role}</span>
                </li>
              ))}
            </ul>
            {spotlightable && (
              <Button
                variant="secondary"
                size="md"
                icon="user-linear"
                onClick={() => onSpotlight!(row.key)}
                className={styles.mapButton}
              >
                {active ? 'Showing on body' : 'Show on map'}
              </Button>
            )}
          </section>
        )}

        {linkedExercises.length > 0 && (
          <section className={styles.sheetSection}>
            <h3 className="t-micro">Linked exercises</h3>
            <ol className={styles.linkedList} aria-label="Linked exercises">
              {linkedExercises.map((step, index) => (
                <li key={step.baseSlug}>
                  <span className={`${styles.linkedIndex} n`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.linkedName}>{step.name}</span>
                  <span className={styles.linkedFreq}>{step.freq}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Sheet>
  )
}
