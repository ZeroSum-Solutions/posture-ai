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
import { bandFromZone, tone } from '@/components/array/severity'
import ExerciseDetailSheet from './ExerciseDetailSheet'
import WhyThisSheet from './WhyThisSheet'

// priority.zone is the engine's warning/danger severity, so its colour comes
// from the shared severity module.
const ZONE_COLOR: Record<'warning' | 'danger', string> = {
  warning: tone(bandFromZone('warning')),
  danger: tone(bandFromZone('danger')),
}
// Step labels (Loosen/Lengthen/.../Connect) are the program's own sequence,
// not a severity — reusing maintain/monitor/review here would make "Loosen"
// misread as a warning and "Strengthen" misread as an all-clear.
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

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        padding: '2px 10px',
        borderRadius: 20,
        fontSize: '0.72rem',
        fontWeight: 700,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        color,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
      <label htmlFor={controlId} style={{ fontSize: '0.64rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Swap</label>
      <select
        id={controlId}
        name={controlId}
        data-testid={controlId}
        value={step.slug}
        onChange={(e) => onSwap(priority.primaryKey, step.baseSlug, e.target.value === step.baseSlug ? null : e.target.value)}
        style={{
          padding: '3px 6px',
          borderRadius: 6,
          background: 'var(--background)',
          border: `1px solid ${swapped ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.12)'}`,
          color: swapped ? 'var(--info)' : 'var(--text-secondary)',
          fontSize: '0.7rem',
          cursor: 'pointer',
          maxWidth: 200,
        }}
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
  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid var(--hairline)',
  }
  const wkTh: React.CSSProperties = { ...th, textAlign: 'center', minWidth: 86 }
  const td: React.CSSProperties = {
    padding: '9px 10px',
    fontSize: '0.82rem',
    color: 'var(--text-secondary)',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    verticalAlign: 'top',
  }
  const wkTd: React.CSSProperties = { ...td, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--hairline)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
            <th style={{ ...th, width: '46%' }}>Step &amp; Exercise</th>
            {WEEK_THEME.map((theme, i) => (
              <th key={i} style={wkTh}>
                <div style={{ color: 'var(--text-secondary)' }}>Week {i + 1}</div>
                <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: 0 }}>{theme}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {priority.steps.map((s) => {
            const stepColor = STEP_COLOR[s.stepLabel] ?? 'var(--info)'
            return (
              <tr key={s.baseSlug}>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <Pill text={s.stepLabel} color={stepColor} />
                    <button
                      data-testid={`exercise-detail-${s.slug}`}
                      onClick={() => onOpenDetail(s.slug, s.name)}
                      style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, color: 'var(--text-primary)', fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted rgba(255,255,255,0.3)', textUnderlineOffset: 3 }}
                    >
                      {s.name}
                    </button>
                    <button
                      data-testid={`why-this-${s.slug}`}
                      onClick={() => onWhyThis(s.slug, s.name, priority.primaryKey, priority.label, MOVEMENT_ACTION[s.category] ?? 'targets')}
                      style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.72rem', color: 'var(--info)', cursor: 'pointer', textDecoration: 'underline dotted rgba(10,131,201,0.4)', textUnderlineOffset: 3 }}
                    >
                      Why this?
                    </button>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', paddingLeft: 2 }}>
                    {s.freq}
                    {s.repRange ? ` · target ${s.repRange.min}–${s.repRange.max} reps` : ''}
                    {s.isIntegrative ? ' · new in week 3' : ''}
                  </div>
                  <SwapControl priority={priority} step={s} onSwap={onSwap} />
                </td>
                {s.weeks.map((dose, i) => (
                  <td key={i} style={{ ...wkTd, color: dose ? 'var(--text-primary)' : 'var(--text-quiet)' }}>
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
  const zoneColor = ZONE_COLOR[priority.zone]
  const principle = priority.hasConnect ? 'Loosen → Strengthen → Connect' : 'Loosen → Strengthen'

  return (
    <div
      data-testid={`priority-card-${priority.primaryKey}`}
      style={{
        background: 'var(--surface-glass)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: `color-mix(in srgb, ${zoneColor} 13%, transparent)`,
            color: zoneColor,
            fontWeight: 800,
            fontSize: '0.95rem',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {priority.rank}
        </span>
        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', flex: 1 }}>{priority.label}</span>
        <Pill text={`${priority.severityWord} · ${priority.zone}`} color={zoneColor} />
        <button
          data-testid={`demote-${priority.primaryKey}`}
          onClick={() => onDemote(priority.primaryKey)}
          title="Demote to monitor only — removes the program for this focus"
          style={{
            padding: '4px 10px',
            borderRadius: 8,
            background: 'none',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--text-tertiary)',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Monitor only
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 14px' }}>{priority.copy.whatItMeans}</p>

      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: 'var(--info)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {principle} <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>— the order is what makes it stick</span>
      </div>

      <RampTable
        priority={priority}
        onSwap={onSwap}
        onOpenDetail={onOpenDetail}
        onWhyThis={onWhyThis}
      />
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
    <div data-testid="corrective-program" style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Corrective Program
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>{report.screeningSummary}</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Client capability
          </span>
          <select
            id="client-capability"
            name="client-capability"
            data-testid="capability-select"
            value={capability}
            onChange={(e) => onCapabilityChange(e.target.value as Capability)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              background: 'var(--background)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            background: 'rgba(34,197,94,0.06)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: 10,
            padding: '8px 12px',
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--maintain)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Maintaining well
          </span>
          {report.positives.map((p) => (
            <span key={p} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {p}
            </span>
          ))}
        </div>
      )}

      {report.hasPlan ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        <div
          style={{
            background: 'var(--surface-glass)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 18,
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          No active corrective priorities. Either every reliable finding is in the maintain zone, or all focuses are set to
          monitor only — share a maintenance plan and re-screen in ~6 weeks.
        </div>
      )}

      {report.monitored.length > 0 && (
        <div
          style={{
            marginTop: 14,
            background: 'var(--surface-glass-strong)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 8,
            }}
          >
            Monitor only — no program ({report.monitored.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {report.monitored.map((m) => (
              <div key={m.primaryKey} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Pill text={`${m.severityWord} · ${m.zone}`} color={ZONE_COLOR[m.zone]} />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>{m.label}</span>
                {report.priorities.length < 3 && (
                  <button
                    data-testid={`promote-${m.primaryKey}`}
                    onClick={() => onPromote(m.primaryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'rgba(10,131,201,0.12)',
                      border: '1px solid rgba(10,131,201,0.3)',
                      color: 'var(--info)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Add to program
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {unreliable.length > 0 && (
        <div
          style={{
            marginTop: 14,
            background: 'var(--surface-glass-strong)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 10,
            padding: '10px 14px',
          }}
        >
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            Couldn&apos;t be read reliably ({unreliable.length})
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            {unreliable.map((u) => u.label).join(', ')} — not shown to the client. Re-capture front/side photos for a fuller
            picture.
          </p>
        </div>
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
