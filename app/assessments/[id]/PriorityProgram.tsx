'use client'
/**
 * Coach-facing corrective program: the ordered Top-3 Priority Focuses and the
 * exact 3-week ramp the client receives, plus the override surface (capability
 * dial, per-exercise swap, demote-to-monitor). Presentational — the parent
 * computes the ProgramReport via buildProgramFrom and persists overrides.
 */
import type { ProgramReport, ProgramPriority, ProgramStep } from '../../../lib/program/buildProgram'
import { swapAlternatives } from '../../../lib/program/buildProgram'
import type { Capability } from '../../../lib/program/selectPriorities'
import { renderDose } from '../../../lib/program/dosage'

const ZONE_COLOR: Record<'warning' | 'danger', string> = { warning: '#F59E0B', danger: '#EF4444' }
const STEP_COLOR: Record<string, string> = {
  Loosen: '#F59E0B',
  Lengthen: '#818CF8',
  'Wake up': '#F472B6',
  Strengthen: '#22C55E',
  Connect: '#A78BFA',
}
const WEEK_THEME = ['Learn & Own', 'Reinforce', 'Consolidate']
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
        background: color + '22',
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
  priority: ProgramPriority
  step: ProgramStep
  onSwap: OverrideHandlers['onSwap']
}) {
  const otherSlugs = priority.steps.filter((s) => s.baseSlug !== step.baseSlug).map((s) => s.slug)
  const alts = swapAlternatives(priority.keys, priority.zone, step.category, otherSlugs)
  if (alts.length <= 1) return null // nothing to swap to

  const swapped = step.slug !== step.baseSlug
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
      <span style={{ fontSize: '0.64rem', color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Swap</span>
      <select
        data-testid={`swap-${priority.primaryKey}-${step.baseSlug}`}
        value={step.slug}
        onChange={(e) => onSwap(priority.primaryKey, step.baseSlug, e.target.value === step.baseSlug ? null : e.target.value)}
        style={{
          padding: '3px 6px',
          borderRadius: 6,
          background: '#0A0A0B',
          border: `1px solid ${swapped ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.12)'}`,
          color: swapped ? '#C4B5FD' : '#A1A1AA',
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

function RampTable({ priority, onSwap }: { priority: ProgramPriority; onSwap: OverrideHandlers['onSwap'] }) {
  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#8A8A93',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #2B2B31',
  }
  const wkTh: React.CSSProperties = { ...th, textAlign: 'center', minWidth: 86 }
  const td: React.CSSProperties = {
    padding: '9px 10px',
    fontSize: '0.82rem',
    color: '#D4D4D8',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    verticalAlign: 'top',
  }
  const wkTd: React.CSSProperties = { ...td, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #2B2B31' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
            <th style={{ ...th, width: '46%' }}>Step &amp; Exercise</th>
            {WEEK_THEME.map((theme, i) => (
              <th key={i} style={wkTh}>
                <div style={{ color: '#A1A1AA' }}>Week {i + 1}</div>
                <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#A1A1AA', letterSpacing: 0 }}>{theme}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {priority.steps.map((s) => {
            const stepColor = STEP_COLOR[s.stepLabel] ?? '#6366F1'
            return (
              <tr key={s.baseSlug}>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <Pill text={s.stepLabel} color={stepColor} />
                    <span style={{ fontWeight: 600, color: '#F5F5F5' }}>{s.name}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#A1A1AA', paddingLeft: 2 }}>
                    {s.freq}
                    {s.repRange ? ` · target ${s.repRange.min}–${s.repRange.max} reps` : ''}
                    {s.isIntegrative ? ' · new in week 3' : ''}
                  </div>
                  <SwapControl priority={priority} step={s} onSwap={onSwap} />
                </td>
                {s.weeks.map((dose, i) => (
                  <td key={i} style={{ ...wkTd, color: dose ? '#E4E4E7' : '#3F3F46' }}>
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

function PriorityCard({ priority, onDemote, onSwap }: { priority: ProgramPriority } & Pick<OverrideHandlers, 'onDemote' | 'onSwap'>) {
  const zoneColor = ZONE_COLOR[priority.zone]
  const principle = priority.hasConnect ? 'Loosen → Strengthen → Connect' : 'Loosen → Strengthen'

  return (
    <div
      data-testid={`priority-card-${priority.primaryKey}`}
      style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: `3px solid ${zoneColor}`,
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
            background: zoneColor + '22',
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
        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#F5F5F5', flex: 1 }}>{priority.label}</span>
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
            color: '#8A8A93',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Monitor only
        </button>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#A1A1AA', lineHeight: 1.5, margin: '0 0 14px' }}>{priority.copy.whatItMeans}</p>

      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#818CF8',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {principle} <span style={{ color: '#A1A1AA', fontWeight: 600 }}>— the order is what makes it stick</span>
      </div>

      <RampTable priority={priority} onSwap={onSwap} />
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
  report: ProgramReport
  unreliable: { label: string }[]
  capability: Capability
  onCapabilityChange: (c: Capability) => void
} & OverrideHandlers) {
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
          <h2
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#A1A1AA',
              margin: 0,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Corrective Program
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#A1A1AA', margin: '4px 0 0' }}>{report.gradeHuman}</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.66rem', color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Client capability
          </span>
          <select
            data-testid="capability-select"
            value={capability}
            onChange={(e) => onCapabilityChange(e.target.value as Capability)}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              background: '#0A0A0B',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#F5F5F5',
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
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Maintaining well
          </span>
          {report.positives.map((p) => (
            <span key={p} style={{ fontSize: '0.78rem', color: '#A1A1AA' }}>
              {p}
            </span>
          ))}
        </div>
      )}

      {report.hasPlan ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {report.priorities.map((p) => (
            <PriorityCard key={p.primaryKey} priority={p} onDemote={onDemote} onSwap={onSwap} />
          ))}
        </div>
      ) : (
        <div
          style={{
            background: '#161618',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 18,
            fontSize: '0.85rem',
            color: '#A1A1AA',
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
            background: '#131315',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#8A8A93',
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
                <span style={{ fontSize: '0.82rem', color: '#D4D4D8', flex: 1 }}>{m.label}</span>
                {report.priorities.length < 3 && (
                  <button
                    data-testid={`promote-${m.primaryKey}`}
                    onClick={() => onPromote(m.primaryKey)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 8,
                      background: 'rgba(99,102,241,0.12)',
                      border: '1px solid rgba(99,102,241,0.3)',
                      color: '#818CF8',
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
            background: '#111113',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 10,
            padding: '10px 14px',
          }}
        >
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color: '#A1A1AA',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 4,
            }}
          >
            Couldn&apos;t be read reliably ({unreliable.length})
          </div>
          <p style={{ fontSize: '0.78rem', color: '#A1A1AA', margin: 0, lineHeight: 1.5 }}>
            {unreliable.map((u) => u.label).join(', ')} — not shown to the client. Re-capture front/side photos for a fuller
            picture.
          </p>
        </div>
      )}
    </div>
  )
}
