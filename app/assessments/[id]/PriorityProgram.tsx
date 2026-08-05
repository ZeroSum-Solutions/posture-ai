'use client'
/**
 * Coach-facing corrective program: the ordered Top-3 Priority Focuses and the
 * exact 3-week ramp the client receives, plus the override surface (capability
 * dial, per-exercise swap, demote-to-monitor). Presentational — the parent
 * receives a server-computed, release-scoped program and persists overrides.
 */
import { useState } from 'react'
import type {
  ClinicalProgramPriority,
  ClinicalProgramReport,
  ClinicalProgramStep,
} from '../../../lib/program/clinicalProjection'
import type { Capability } from '../../../lib/program/selectPriorities'
import { renderDose } from '../../../lib/program/dosage'
import { Surface } from '@/components/array/Surface'
import { Chip } from '@/components/array/Chip'
import { bandFromZone, ring, tint, tone, type SeverityBand } from '@/components/array/severity'
import ExerciseDetailSheet from './ExerciseDetailSheet'
import WhyThisSheet from './WhyThisSheet'
import styles from './PriorityProgram.module.css'

// priority.zone is the engine's warning/danger severity, so its band comes
// from the shared severity module — the Chip, the rank badge and the "add to
// program" control all key off the same map.
const ZONE_BAND: Record<'warning' | 'danger', SeverityBand> = {
  warning: bandFromZone('warning'),
  danger: bandFromZone('danger'),
}
// Step labels (Loosen/Lengthen/.../Connect) are the program's own sequence,
// not a severity — reusing maintain/monitor/review here would make "Loosen"
// misread as a warning and "Strengthen" misread as an all-clear. These stay
// literal hex, byte-identical to WorkoutPlayer's copy, and are never routed
// through severity.ts.
const STEP_COLOR: Record<string, string> = {
  Loosen: '#818CF8',
  Lengthen: '#22D3EE',
  'Wake up': '#F472B6',
  Strengthen: '#38BDF8',
  Connect: '#A78BFA',
}
const WEEK_THEME = ['Learn & Own', 'Reinforce', 'Consolidate']
const MOVEMENT_ACTION: Record<string, string> = {
  stretch: 'lengthens',
  strengthen: 'strengthens',
  mobility: 'mobilizes',
  activation: 'activates',
}

const CAP_OPTIONS: { value: Capability; label: string }[] = [
  { value: 'regression', label: 'Regression (deconditioned)' },
  { value: 'standard', label: 'Standard' },
  { value: 'progression', label: 'Progression (fit / advanced)' },
]

interface OverrideHandlers {
  onDemote: (primaryKey: string) => void
  onPromote: (primaryKey: string) => void
  onSwap: (primaryKey: string, baseSlug: string, toSlug: string | null) => void
}

/**
 * The step-sequence pill. Visually it matches the Chip's 16%-tint/42%-ring
 * convention, but it takes a raw hex from STEP_COLOR rather than a
 * SeverityBand — see the comment on STEP_COLOR for why a step label must
 * never be able to resolve to a clinical band colour.
 */
function StepPill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className={styles.stepPill}
      style={{
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 42%, transparent)`,
        color,
      }}
    >
      {text}
    </span>
  )
}

function SwapControl({
  priority,
  step,
  onSwap,
}: {
  priority: ClinicalProgramPriority
  step: ClinicalProgramStep
  onSwap: OverrideHandlers['onSwap']
}) {
  const alts = step.alternatives
  if (alts.length <= 1) return null // nothing to swap to

  const swapped = step.slug !== step.baseSlug
  const controlId = `swap-${priority.primaryKey}-${step.baseSlug}`
  return (
    <div className={styles.swapRow}>
      <label htmlFor={controlId} className="t-kicker">Swap</label>
      <select
        id={controlId}
        name={controlId}
        data-testid={controlId}
        value={step.slug}
        onChange={(e) => onSwap(priority.primaryKey, step.baseSlug, e.target.value === step.baseSlug ? null : e.target.value)}
        className={styles.swapSelect}
        /* A swapped exercise is an informational state, not a severity — it
           borrows the shared `info` band the rest of this file already uses
           for "Why this?" and "Add to program", replacing the pre-migration
           border that was an unrouted violet paired with the `info` text. */
        style={swapped
          ? { background: tint('info'), boxShadow: `inset 0 0 0 1px ${ring('info')}`, color: tone('info') }
          : undefined}
      >
        {alts.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.name}
            {a.slug === step.baseSlug ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function RampTable({
  priority,
  onSwap,
  onOpenDetail,
  onWhyThis,
}: {
  priority: ClinicalProgramPriority
  onSwap: OverrideHandlers['onSwap']
  onOpenDetail: (slug: string, name: string) => void
  onWhyThis: (slug: string, name: string, findingKey: string, findingLabel: string, movementAction: string) => void
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.theadRow}>
            <th className={`${styles.th} t-kicker`} style={{ width: '46%' }}>Step &amp; Exercise</th>
            {WEEK_THEME.map((theme, i) => (
              <th key={i} className={`${styles.th} ${styles.thWeek} t-kicker`}>
                <div>Week {i + 1}</div>
                <div className={styles.thTheme}>{theme}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {priority.steps.map((s) => {
            const stepColor = STEP_COLOR[s.stepLabel] ?? 'var(--info)'
            return (
              <tr key={s.baseSlug}>
                <td className={styles.td}>
                  <div className={styles.stepRow}>
                    <StepPill text={s.stepLabel} color={stepColor} />
                    <button
                      data-testid={`exercise-detail-${s.slug}`}
                      onClick={() => onOpenDetail(s.slug, s.name)}
                      className={styles.exerciseButton}
                    >
                      {s.name}
                    </button>
                    <button
                      data-testid={`why-this-${s.slug}`}
                      onClick={() => onWhyThis(s.slug, s.name, priority.primaryKey, priority.label, MOVEMENT_ACTION[s.category] ?? 'targets')}
                      className={styles.whyThisButton}
                    >
                      Why this?
                    </button>
                  </div>
                  <div className={`${styles.stepMeta} t-quiet`}>
                    {s.freq}
                    {s.repRange ? ` · target ${s.repRange.min}–${s.repRange.max} reps` : ''}
                    {s.isIntegrative ? ' · new in week 3' : ''}
                  </div>
                  <SwapControl priority={priority} step={s} onSwap={onSwap} />
                </td>
                {s.weeks.map((dose, i) => (
                  <td
                    key={i}
                    className={`${styles.td} ${styles.tdWeek} n`}
                    style={{ color: dose ? 'var(--text-primary)' : 'var(--text-quiet)' }}
                  >
                    {renderDose(dose)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PriorityCard({
  priority,
  onDemote,
  onSwap,
  onOpenDetail,
  onWhyThis,
}: {
  priority: ClinicalProgramPriority
  onOpenDetail: (slug: string, name: string) => void
  onWhyThis: (slug: string, name: string, findingKey: string, findingLabel: string, movementAction: string) => void
} & Pick<OverrideHandlers, 'onDemote' | 'onSwap'>) {
  const band = ZONE_BAND[priority.zone]
  const principle = priority.hasConnect ? 'Loosen → Strengthen → Connect' : 'Loosen → Strengthen'

  return (
    <div data-testid={`priority-card-${priority.primaryKey}`}>
      <Surface tier="tile">
        <div className={styles.cardHead}>
          <span
            className={styles.rank}
            style={{ background: tint(band), boxShadow: `inset 0 0 0 1px ${ring(band)}`, color: tone(band) }}
          >
            {priority.rank}
          </span>
          <span className={`t-title ${styles.cardTitle}`}>{priority.label}</span>
          <Chip band={band} size="sm">{priority.severityWord} · {priority.zone}</Chip>
          <button
            data-testid={`demote-${priority.primaryKey}`}
            onClick={() => onDemote(priority.primaryKey)}
            title="Demote to monitor only — removes the program for this focus"
            className={styles.demoteButton}
          >
            Monitor only
          </button>
        </div>

        <p className="t-body" style={{ marginBottom: 14 }}>{priority.copy.whatItMeans}</p>

        <p className={styles.principle}>
          <span style={{ color: tone('info') }}>{principle}</span>{' '}
          <span className="t-quiet">— the order is what makes it stick</span>
        </p>

        <RampTable
          priority={priority}
          onSwap={onSwap}
          onOpenDetail={onOpenDetail}
          onWhyThis={onWhyThis}
        />
      </Surface>
    </div>
  )
}

export default function PriorityProgram({
  report,
  unreliable,
  capability,
  onCapabilityChange,
  onDemote,
  onPromote,
  onSwap,
}: {
  report: ClinicalProgramReport
  unreliable: { label: string }[]
  capability: Capability
  onCapabilityChange: (c: Capability) => void
} & OverrideHandlers) {
  const [detail, setDetail] = useState<{ slug: string; name: string } | null>(null)
  const [whyThis, setWhyThis] = useState<{
    slug: string
    name: string
    findingKey: string
    findingLabel: string
    movementAction: string
  } | null>(null)
  return (
    <div data-testid="corrective-program" className={`app-stack ${styles.root}`}>
      <div className={styles.header}>
        <div>
          <h3 className="t-kicker">Corrective Program</h3>
          <p className="t-body" style={{ marginTop: 4 }}>{report.screeningSummary}</p>
        </div>
        <label className={styles.capabilityField}>
          <span className="t-kicker">Client capability</span>
          <select
            id="client-capability"
            name="client-capability"
            data-testid="capability-select"
            value={capability}
            onChange={(e) => onCapabilityChange(e.target.value as Capability)}
            className="a-select"
          >
            {CAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {report.positives.length > 0 && (
        <Surface tier="tile" pad="rowy" innerClassName={styles.positivesRow}>
          {/* Was a hardcoded rgba(34,197,94,...) wash — Tailwind green-500, not
              the Array maintain band (#10B981). The label now carries the
              colour as a Chip; the finding names sit on the tile's plain
              glass, per the contract's "never a filled block behind body
              text" rule. */}
          <Chip band="maintain" size="sm">Maintaining well</Chip>
          {report.positives.map((p) => (
            <span key={p} className="t-body">
              {p}
            </span>
          ))}
        </Surface>
      )}

      {report.hasPlan ? (
        <div className="app-stack">
          {report.priorities.map((p) => (
            <PriorityCard
              key={p.primaryKey}
              priority={p}
              onDemote={onDemote}
              onSwap={onSwap}
              onOpenDetail={(slug, name) => setDetail({ slug, name })}
              onWhyThis={(slug, name, findingKey, findingLabel, movementAction) =>
                setWhyThis({ slug, name, findingKey, findingLabel, movementAction })
              }
            />
          ))}
        </div>
      ) : (
        <Surface tier="tile">
          <p className="t-body">
            No active corrective priorities. Either every reliable finding is in the maintain zone, or all focuses are set to
            monitor only — share a maintenance plan and re-screen in ~6 weeks.
          </p>
        </Surface>
      )}

      {report.monitored.length > 0 && (
        <Surface tier="tile">
          <p className="t-kicker" style={{ marginBottom: 8 }}>
            Monitor only — no program ({report.monitored.length})
          </p>
          <div className={styles.monitoredList}>
            {report.monitored.map((m) => {
              const band = ZONE_BAND[m.zone]
              return (
                <div key={m.primaryKey} className={styles.monitoredRow}>
                  <Chip band={band} size="sm">{m.severityWord} · {m.zone}</Chip>
                  <span className="t-body" style={{ flex: 1 }}>{m.label}</span>
                  {report.priorities.length < 3 && (
                    <button
                      data-testid={`promote-${m.primaryKey}`}
                      onClick={() => onPromote(m.primaryKey)}
                      className={styles.promoteButton}
                      style={{ background: tint('info'), boxShadow: `inset 0 0 0 1px ${ring('info')}`, color: tone('info') }}
                    >
                      Add to program
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Surface>
      )}

      {unreliable.length > 0 && (
        <Surface tier="tile">
          <p className="t-kicker" style={{ marginBottom: 4 }}>
            Couldn&apos;t be read reliably ({unreliable.length})
          </p>
          <p className="t-body">
            {unreliable.map((u) => u.label).join(', ')} — not shown to the client. Re-capture front/side photos for a fuller
            picture.
          </p>
        </Surface>
      )}

      {detail && <ExerciseDetailSheet slug={detail.slug} name={detail.name} onClose={() => setDetail(null)} />}
      {whyThis && (
        <WhyThisSheet
          exerciseName={whyThis.name}
          findingKey={whyThis.findingKey}
          findingLabel={whyThis.findingLabel}
          movementAction={whyThis.movementAction}
          onClose={() => setWhyThis(null)}
        />
      )}
    </div>
  )
}
