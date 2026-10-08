'use client'
import { useState } from 'react'
import { ListRow, ListGroup, SeverityChip, Sheet, Disclosure, Button, EmptyState, Readout } from '@/components/ui'
import type { SeverityBand } from '@/components/array/severity'
import { hasAnyMuscle } from './muscleMap'
import type { ReviewFindingRow } from './reviewModel'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'
import styles from './Results.module.css'

const GROUP_ORDER: SeverityBand[] = ['review', 'monitor', 'maintain']
const GROUP_LABEL: Record<string, string> = { review: 'Review', monitor: 'Monitor', maintain: 'Maintain' }

function toChipBand(band: SeverityBand): 'maintain' | 'monitor' | 'review' | 'neutral' {
  return band === 'maintain' || band === 'monitor' || band === 'review' ? band : 'neutral'
}

function viewLabel(view: string | undefined): string | undefined {
  if (!view) return undefined
  return view.charAt(0).toUpperCase() + view.slice(1)
}

/** Splits the pre-formatted "12.4°" string back into a number + unit for Readout. */
function parseMeasurement(measurement: string | null): { value: number | null; unit: string } {
  if (!measurement) return { value: null, unit: '' }
  const match = measurement.match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  if (!match) return { value: null, unit: '' }
  return { value: Number(match[1]), unit: match[2] ?? '' }
}

/**
 * One row per finding: name, the view it was measured on, and a single
 * trailing SeverityChip + chevron (audit #6 — severity shown once, never
 * twice). Grouped Review → Monitor → Maintain, Maintain collapsed (DESIGN.md
 * › 3.13, spec §5 Results). Tapping a row opens its detail in a Sheet: the
 * Readout with reference range, why-this text, muscle chips with "Show on
 * map", and any linked program exercises.
 */
export default function ReviewFindings({
  rows,
  viewByKey,
  program,
  activeKey = null,
  onSpotlight,
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
  /** What to say when there are no rows. */
  emptyText?: string
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const openRow = rows.find((row) => row.key === openKey) ?? null

  if (rows.length === 0) {
    return <EmptyState icon="check-circle-linear" variant="inline" title="No findings" body={emptyText} />
  }

  const counts = { review: 0, monitor: 0, maintain: 0 }
  for (const row of rows) {
    if (row.band === 'review' || row.band === 'monitor' || row.band === 'maintain') counts[row.band] += 1
  }
  const groups = GROUP_ORDER
    .map((band) => ({ band, items: rows.filter((row) => row.band === band) }))
    .filter((group) => group.items.length > 0)

  return (
    <div>
      <p className="t-footnote" style={{ color: 'var(--text-2)' }}>
        {rows.length} finding{rows.length === 1 ? '' : 's'}: {counts.review} Review · {counts.monitor} Monitor · {counts.maintain} Maintain
      </p>

      {groups.map((group) => {
        const list = (
          <ListGroup label={`${GROUP_LABEL[group.band]} findings`}>
            {group.items.map((row) => (
              <ListRow
                key={row.id}
                data-testid="finding-row"
                title={row.label}
                subtitle={viewLabel(viewByKey?.[row.key])}
                trailing={<SeverityChip band={toChipBand(row.band)} size="sm" />}
                chevron
                onPress={() => setOpenKey(row.key)}
              />
            ))}
          </ListGroup>
        )
        return (
          <div key={group.band} className={styles.findingGroup}>
            {group.band === 'maintain' ? (
              <Disclosure title={`${GROUP_LABEL[group.band]} (${group.items.length})`}>{list}</Disclosure>
            ) : (
              <>
                <span className={`t-overline ${styles.findingGroupLabel}`}>{GROUP_LABEL[group.band]}</span>
                {list}
              </>
            )}
          </div>
        )
      })}

      {openRow && (
        <FindingSheet
          row={openRow}
          view={viewByKey?.[openRow.key]}
          program={program}
          active={activeKey === openRow.key}
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
  onSpotlight,
  onClose,
}: {
  row: ReviewFindingRow
  view?: string
  program?: ClinicalProgramReport | null
  active: boolean
  onSpotlight?: (key: string) => void
  onClose: () => void
}) {
  const { value, unit } = parseMeasurement(row.measurement)
  const referenceText = row.reference ? row.reference.replace(/^ref\s*/, '') : undefined
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

  return (
    <Sheet
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={row.label}
      detents={['medium']}
      data-testid={`finding-sheet-${row.key}`}
    >
      {view && <p className="t-footnote" style={{ color: 'var(--text-3)', marginBottom: 'var(--s-16)' }}>{viewLabel(view)} view</p>}

      <Readout
        label={row.label}
        value={row.reliable ? value : null}
        unit={unit || undefined}
        reference={referenceText ? { text: referenceText } : undefined}
        band={toChipBand(row.band)}
        size="lg"
      />

      {!row.reliable && (
        <p className="t-footnote" style={{ color: 'var(--review)', marginTop: 'var(--s-8)' }}>
          Reading not usable — re-capture this view.
        </p>
      )}
      {row.deltaWord && (
        <p className="t-footnote" style={{ color: 'var(--text-3)', marginTop: 'var(--s-8)' }}>
          {row.deltaWord === 'not comparable' ? 'Not comparable with the previous scan.' : row.deltaWord}
        </p>
      )}

      <div style={{ marginTop: 'var(--s-20)' }}>
        <p className="t-caption" style={{ color: 'var(--text-3)', textTransform: 'uppercase', margin: '0 0 var(--s-4)' }}>Why this</p>
        <p className="t-body" style={{ color: 'var(--text-2)', margin: 0 }}>
          {row.causes ?? `${row.label} reads outside the ${row.zoneLabel.toLowerCase()} range for this screening.`}
        </p>
      </div>

      {muscles.length > 0 && (
        <div style={{ marginTop: 'var(--s-20)' }}>
          <p className="t-caption" style={{ color: 'var(--text-3)', textTransform: 'uppercase', margin: '0 0 var(--s-8)' }}>Muscles involved</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-8)' }}>
            {muscles.map((muscle) => (
              <span
                key={muscle.slug}
                className="t-footnote"
                style={{ padding: '4px 10px', borderRadius: 'var(--r-full)', background: 'var(--surface-flat)', boxShadow: 'inset 0 0 0 1px var(--hairline)', color: 'var(--text-1)' }}
              >
                {muscle.name} · {muscle.role}
              </span>
            ))}
          </div>
          {spotlightable && (
            <Button variant="secondary" size="sm" icon="user-linear" onClick={() => onSpotlight!(row.key)} style={{ marginTop: 'var(--s-12)' }}>
              {active ? 'Showing on body' : 'Show on map'}
            </Button>
          )}
        </div>
      )}

      {linkedExercises.length > 0 && (
        <div style={{ marginTop: 'var(--s-20)' }}>
          <p className="t-caption" style={{ color: 'var(--text-3)', textTransform: 'uppercase', margin: '0 0 var(--s-8)' }}>Linked exercises</p>
          <ListGroup label="Linked exercises">
            {linkedExercises.map((step) => (
              <ListRow key={step.baseSlug} title={step.name} subtitle={step.freq} />
            ))}
          </ListGroup>
        </div>
      )}
    </Sheet>
  )
}
