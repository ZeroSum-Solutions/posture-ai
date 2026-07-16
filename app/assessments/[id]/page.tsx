'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PriorityProgram from './PriorityProgram'
import ReviewDock from './ReviewDock'
import styles from './AssessmentReviewStudio.module.css'
import MuscleBodyMap from './MuscleBodyMap'
import MuscleModel3D from './MuscleModel3D'
import { hasAnyMuscle, type MuscleLink } from './muscleMap'
import { saveOverridePatch } from './saveOverride'
import {
  createOverrideQueue,
  type OverridePatch,
  type OverrideSaveState,
} from './overrideQueue'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import type { Capability } from '@/lib/program/selectPriorities'
import { toEngineFinding } from '@/lib/findings/storedFindingToEngine'
import { generateWorkoutSession } from '@/lib/workout/generateWorkoutSession'
import { deriveExerciseRecommendations } from '@/lib/exercises'
import { ALL_EXERCISES } from '@/content'
import type { ExerciseContent } from '@/content/muscles/types'

type OverallGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'
type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'

interface Finding {
  id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  direction: string
  severity_pct: number
  zone: Zone
  view_used: string
  confidence: number
  stability_score?: number | null
  uncertainty_deg?: number | null
  borderline?: boolean | null
  metric_validity?: string | null
  explanation?: string | null
  causes_text?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  tight_muscle_links?: MuscleLink[]
  weak_muscle_links?: MuscleLink[]
}

interface Capture {
  id: string
  view: string
  profile_side: 'left' | 'right' | null
  signed_url: string | null
  source: string
  capture_roll_deg: number | null
}
interface Assessment {
  id: string
  status: string
  overall_score: number
  overall_grade: OverallGrade
  overall_percentile: number | null
  front_rank: number | null
  side_rank: number | null
  scoring_engine_version: string | null
  tilt_corrected: boolean | null
  level_verified: boolean | null
  capture_stability?: number | null
  assessed_at: string
  priority_keys?: string[] | null
  capability?: string | null
  exercise_swaps?: Record<string, Record<string, string>> | null
  practitioner_approved?: boolean | null
  clients: { id: string; first_name: string; last_name: string }
}

// Grade → color mapping
function gradeColor(grade: OverallGrade): string {
  if (grade === 'S' || grade === 'A') return 'var(--maintain)'
  if (grade === 'B' || grade === 'C') return 'var(--warning)'
  return 'var(--danger)'
}

// Zone colors
const ZONE_COLORS: Record<Zone, string> = {
  maintain: 'var(--maintain)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  unreliable: 'var(--text-muted)',
}

// Band reference table
const GRADE_BANDS = [
  { grade: 'S', range: '0–5', desc: 'Elite', color: 'var(--maintain)' },
  { grade: 'A', range: '5–15', desc: 'Excellent', color: 'var(--maintain)' },
  { grade: 'B', range: '15–50', desc: 'Good', color: 'var(--warning)' },
  { grade: 'C', range: '50–85', desc: 'Fair', color: 'var(--warning)' },
  { grade: 'D', range: '85–95', desc: 'Poor', color: 'var(--danger)' },
  { grade: 'E', range: '95–100', desc: 'Critical', color: 'var(--danger)' },
]

const REGION_ORDER: Record<string, number> = { head_shoulders: 0, spine: 1, pelvis: 2, leg: 3 }
const REGION_LABELS: Record<string, string> = {
  head_shoulders: 'Head & Shoulders',
  spine: 'Spine',
  pelvis: 'Pelvis',
  leg: 'Legs',
}

// ---- Skeletal Diagram: Front View positions ----
const FRONT_ANNOTATION_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  anterior_imbalanced_shoulders: { x: 90, y: 62, label: 'Shoulder' },
  posterior_imbalanced_shoulders: { x: 90, y: 62, label: 'Shoulder' },
  pelvic_obliquity: { x: 90, y: 218, label: 'Pelvis' },
  genu_varum_valgum_left: { x: 60, y: 305, label: 'L Knee' },
  genu_varum_valgum_right: { x: 120, y: 305, label: 'R Knee' },
}

// ---- Skeletal Diagram: Side View positions ----
const SIDE_ANNOTATION_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  forward_head_posture: { x: 82, y: 28, label: 'Head' },
  t1_tilt_backward: { x: 68, y: 115, label: 'T1' },
  trunk_lean: { x: 68, y: 115, label: 'T1' },
  anterior_pelvic_shift: { x: 75, y: 220, label: 'Pelvis' },
  knee_extension_back_knee: { x: 75, y: 305, label: 'Knee' },
}

function AngleMarker({ x, y, color, severity, label }: { x: number; y: number; color: string; severity: number; label: string }) {
  const r = severity >= 50 ? 16 : severity >= 20 ? 12 : 9
  return (
    <g>
      <circle cx={x} cy={y} r={r + 7} fill={color} fillOpacity="0.06" />
      <circle cx={x} cy={y} r={r + 2} fill={color} fillOpacity="0.07" stroke={color} strokeOpacity=".72" strokeWidth="1.4" />
      <circle cx={x} cy={y} r={3} fill={color}/>
      <text x={x} y={y + r + 14} textAnchor="middle" fill={color} fontSize="8" fontWeight="700">
        {label}
      </text>
    </g>
  )
}

function DirectionArrow({ x, y, color, direction, view }: { x: number; y: number; color: string; direction: string; view: 'front' | 'side' }) {
  const dx = view === 'front'
    ? (direction.includes('Left') || direction.includes('left') ? -14 : 14)
    : (direction.includes('Forward') || direction.includes('forward') || direction.includes('Anterior') ? 14 : -14)
  const dy = view === 'side' && direction.includes('Forward') ? -8 : 0
  return (
    <line
      x1={x} y1={y}
      x2={x + dx} y2={y + dy}
      stroke={color}
      strokeWidth="2.5"
      markerEnd={`url(#arrow${view === 'side' ? '-side' : ''}-${color.replace('#', '')})`}
    />
  )
}

function FrontSkeleton({ findings, captureUrl }: { findings: Finding[]; captureUrl: string | null }) {
  const relevantFindings = findings.filter(f => f.view_used === 'front' && FRONT_ANNOTATION_POSITIONS[f.imbalance_key])
  const uniqueColors = [...new Set(relevantFindings.map(f => ZONE_COLORS[f.zone]))]

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {captureUrl && (
        <div style={{ position: 'absolute', top: 4, right: -48, width: 40, height: 60, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, overflow: 'hidden', background: '#111' }}>
          <img src={captureUrl} alt="Front view" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <svg viewBox="0 0 180 410" width="160" height="365" aria-label="Front view skeletal diagram" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="front-body-glow" x1="36" y1="52" x2="142" y2="370" gradientUnits="userSpaceOnUse"><stop stopColor="#FF8918" stopOpacity=".19" /><stop offset=".48" stopColor="#FFFFFF" stopOpacity=".035" /><stop offset="1" stopColor="#0098F3" stopOpacity=".17" /></linearGradient>
          {uniqueColors.map(color => (
            <marker key={color} id={`arrow-${color.replace('#', '')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color}/>
            </marker>
          ))}
        </defs>
        <path d="M90 47C62 47 48 67 43 105l-12 88c-2 15 8 24 20 21l15-5-8 91c-1 8 3 13 10 13h44c7 0 11-5 10-13l-8-91 15 5c12 3 22-6 20-21l-12-88c-5-38-19-58-47-58Z" fill="url(#front-body-glow)" />
        <circle cx="90" cy="26" r="20" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <line x1="90" y1="46" x2="90" y2="62" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <line x1="48" y1="62" x2="132" y2="62" stroke="rgba(255,255,255,0.32)" strokeWidth="3"/>
        <line x1="48" y1="62" x2="28" y2="132" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <line x1="28" y1="132" x2="16" y2="190" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <line x1="132" y1="62" x2="152" y2="132" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <line x1="152" y1="132" x2="164" y2="190" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <path d="M 90 80 Q 62 95 58 120" stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <path d="M 90 80 Q 118 95 122 120" stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <line x1="62" y1="218" x2="118" y2="218" stroke="rgba(255,255,255,0.32)" strokeWidth="3"/>
        <line x1="62" y1="218" x2="58" y2="305" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <line x1="118" y1="218" x2="122" y2="305" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <circle cx="58" cy="305" r="5" stroke="rgba(255,255,255,0.32)" strokeWidth="2" fill="var(--surface)"/>
        <circle cx="122" cy="305" r="5" stroke="rgba(255,255,255,0.32)" strokeWidth="2" fill="var(--surface)"/>
        <line x1="58" y1="310" x2="56" y2="390" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <line x1="122" y1="310" x2="124" y2="390" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <line x1="42" y1="392" x2="68" y2="392" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <line x1="112" y1="392" x2="138" y2="392" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <path d="M40 398H140" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        {relevantFindings.map(f => {
          const pos = FRONT_ANNOTATION_POSITIONS[f.imbalance_key]
          const color = ZONE_COLORS[f.zone]
          return (
            <g key={f.imbalance_key}>
              <AngleMarker x={pos.x} y={pos.y} color={color} severity={f.severity_pct} label={pos.label}/>
              {f.direction && f.direction !== 'Neutral' && f.direction !== 'Level' && (
                <DirectionArrow x={pos.x} y={pos.y} color={color} direction={f.direction} view="front"/>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SideSkeleton({ findings, captureUrl }: { findings: Finding[]; captureUrl: string | null }) {
  const relevantFindings = findings.filter(f => f.view_used === 'side' && SIDE_ANNOTATION_POSITIONS[f.imbalance_key])
  const uniqueColors = [...new Set(relevantFindings.map(f => ZONE_COLORS[f.zone]))]

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {captureUrl && (
        <div style={{ position: 'absolute', top: 4, right: -48, width: 40, height: 60, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, overflow: 'hidden', background: '#111' }}>
          <img src={captureUrl} alt="Side view" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
      <svg viewBox="0 0 150 410" width="130" height="357" aria-label="Side view skeletal diagram" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="side-body-glow" x1="50" y1="42" x2="104" y2="380" gradientUnits="userSpaceOnUse"><stop stopColor="#FF8918" stopOpacity=".18" /><stop offset=".5" stopColor="#FFFFFF" stopOpacity=".03" /><stop offset="1" stopColor="#0098F3" stopOpacity=".16" /></linearGradient>
          {uniqueColors.map(color => (
            <marker key={color} id={`arrow-side-${color.replace('#', '')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color}/>
            </marker>
          ))}
        </defs>
        <path d="M76 47c-18 10-22 34-19 69l6 99c1 14 7 24 15 28l-10 59c-1 8 3 12 10 12h12c6 0 10-5 8-12l-13-67c11-9 15-29 10-49l-13-58 18 53c4 12 14 14 18 5 2-4 1-10-1-16L98 91c-5-25-10-38-22-44Z" fill="url(#side-body-glow)" />
        <circle cx="80" cy="26" r="20" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <path d="M 75 46 Q 70 54 68 62" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <path d="M 68 62 Q 64 80 62 100" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <line x1="68" y1="62" x2="88" y2="120" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <line x1="88" y1="120" x2="95" y2="178" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <path d="M 62 100 Q 58 135 60 165" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <path d="M 60 165 Q 64 192 66 218" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5" fill="none"/>
        <path d="M 66 218 Q 72 228 70 238" stroke="rgba(255,255,255,0.32)" strokeWidth="3" fill="none"/>
        <line x1="70" y1="238" x2="72" y2="305" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <circle cx="72" cy="305" r="5" stroke="rgba(255,255,255,0.32)" strokeWidth="2" fill="var(--surface)"/>
        <line x1="72" y1="310" x2="74" y2="390" stroke="rgba(255,255,255,0.32)" strokeWidth="2.5"/>
        <line x1="60" y1="390" x2="100" y2="390" stroke="rgba(255,255,255,0.32)" strokeWidth="2"/>
        <path d="M50 398H112" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
        {relevantFindings.map(f => {
          const pos = SIDE_ANNOTATION_POSITIONS[f.imbalance_key]
          const color = ZONE_COLORS[f.zone]
          return (
            <g key={f.imbalance_key}>
              <AngleMarker x={pos.x} y={pos.y} color={color} severity={f.severity_pct} label={pos.label}/>
              {f.direction && f.direction !== 'Neutral' && (
                <DirectionArrow x={pos.x} y={pos.y} color={color} direction={f.direction} view="side"/>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SkeletalDiagramSection({
  findings, frontCapture, sideCapture,
}: {
  findings: Finding[]
  frontCapture: Capture | null
  sideCapture: Capture | null
}) {
  // Per the percentile-suppression decision: the engine's per-view "ranks" are a
  // modeled transform of severity, not a real population statistic — never show
  // them as a rank. An honest per-view findings count replaces them.
  function viewFindingsLabel(view: 'front' | 'side'): string {
    const n = findings.filter((f) => f.view_used === view).length
    return n === 0 ? 'No findings marked on this view' : n === 1 ? '1 finding marked' : `${n} findings marked`
  }

  return (
    <div className="app-panel" style={{ padding: 24, marginBottom: 24 }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Postural Alignment Diagram
      </h3>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Front View</div>
          <FrontSkeleton findings={findings} captureUrl={frontCapture?.signed_url ?? null}/>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{viewFindingsLabel('front')}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Side View</div>
          <SideSkeleton findings={findings} captureUrl={sideCapture?.signed_url ?? null}/>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{viewFindingsLabel('side')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
        {[{ color: 'var(--maintain)', label: 'Maintain' }, { color: 'var(--warning)', label: 'Warning' }, { color: 'var(--danger)', label: 'Danger' }].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }}/>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: '0.68rem', color: 'var(--text-secondary)', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
        Diagrams are schematic representations only and do not depict literal measurements or anatomical accuracy.
        Markers indicate regions of interest detected during screening.
      </p>
    </div>
  )
}

// ---- Grade Ring Component ----
function GradeRing({ grade, score }: { grade: OverallGrade; score: number }) {
  const color = gradeColor(grade)
  const r = 42
  const circumference = 2 * Math.PI * r
  const fillPct = Math.max(0, 100 - score) / 100
  const dashOffset = circumference * (1 - fillPct)

  return (
    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" transform="rotate(-90 50 50)"/>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '2rem', fontWeight: 900, color, lineHeight: 1 }}>{grade}</span>
      </div>
    </div>
  )
}

function ScoreBar({ score, grade }: { score: number; grade: OverallGrade }) {
  const color = gradeColor(grade)
  const positionPct = Math.min(100, Math.max(0, score))

  return (
    <div>
      <div style={{ position: 'relative', height: 12, borderRadius: 6, overflow: 'hidden',
        background: 'linear-gradient(to right, var(--maintain) 0%, var(--maintain) 15%, var(--warning) 50%, var(--danger) 85%, var(--danger) 100%)',
        marginBottom: 8 }}>
        <div style={{ position: 'absolute', left: positionPct + '%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 18, height: 18, borderRadius: '50%', background: color, border: '3px solid var(--background)',
          boxShadow: `0 0 8px color-mix(in srgb, ${color} 53%, transparent)` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--maintain)' }}>S (Best)</span>
        <span>Deviation: {score}</span>
        <span style={{ color: 'var(--danger)' }}>E (Worst)</span>
      </div>
    </div>
  )
}

function BandTable({ currentGrade }: { currentGrade: OverallGrade }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grade Reference</h3>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {GRADE_BANDS.map(b => (
          <div key={b.grade} style={{ padding: '6px 10px', borderRadius: 8,
            background: b.grade === currentGrade ? `color-mix(in srgb, ${b.color} 13%, transparent)` : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (b.grade === currentGrade ? b.color : 'rgba(255,255,255,0.08)'),
            textAlign: 'center', minWidth: 56 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900, color: b.color }}>{b.grade}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 1 }}>{b.range}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{b.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Finding Card ----
export function FindingCard({ f }: { f: Finding }) {
  const isUnreliable = f.zone === 'unreliable'
  const zoneColor = ZONE_COLORS[f.zone]
  const [expanded, setExpanded] = useState(false)
  const hasMuscles = hasAnyMuscle({
    tightMuscles: f.tight_muscles ?? [],
    weakMuscles: f.weak_muscles ?? [],
    tightLinks: f.tight_muscle_links ?? [],
    weakLinks: f.weak_muscle_links ?? [],
  })

  return (
    <div
      data-testid={`finding-card-${f.imbalance_key}`}
      style={{
        background: isUnreliable ? 'var(--surface-elevated)' : 'var(--surface)',
        border: '1px solid ' + (isUnreliable ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)'),
        borderRadius: 12, padding: 16,
        opacity: isUnreliable ? 0.65 : 1,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 600, color: isUnreliable ? 'var(--text-secondary)' : 'var(--text-primary)', fontSize: '0.9rem' }}>
          {f.label}
          <span style={{ marginLeft: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>({f.view_used} view)</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isUnreliable && (
            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
              background: 'rgba(113,113,122,0.2)', color: 'var(--text-muted)', border: '1px solid rgba(113,113,122,0.4)',
              textTransform: 'uppercase' }}>Unreliable</span>
          )}
          <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
            background: `color-mix(in srgb, ${zoneColor} 13%, transparent)`, color: isUnreliable ? 'var(--text-secondary)' : zoneColor, textTransform: 'uppercase' }}>{f.zone}</span>
          {f.borderline ? (
            <span title="This reading sits within its own capture variability of a zone boundary — consider the zone as approximate."
              style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>
              ± borderline
            </span>
          ) : null}
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {/* VALIDATED needs its own label when the first metric is promoted
                by the Layer-1 study — this ternary would mislabel it. */}
            {f.metric_validity === 'LITERATURE_CITED' ? 'Literature-referenced thresholds' : 'Screening estimate'}
          </span>
        </div>
      </div>

      {/* Deviation */}
      <div style={{ fontSize: '0.875rem', color: isUnreliable ? 'var(--text-secondary)' : 'var(--text-secondary)', marginBottom: 10 }}>
        <strong>{Number(f.deviation).toFixed(1)}&deg;</strong> deviation from 0&deg; standard
        {f.direction && f.direction !== 'Neutral' && f.direction !== 'Level' && (
          <span style={{ color: 'var(--text-secondary)' }}> — {f.direction}</span>
        )}
      </div>

      {/* Severity bar */}
      {!isUnreliable && (
        <div style={{ marginBottom: f.causes_text ? 12 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Severity</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: zoneColor }}>{f.severity_pct}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: f.severity_pct + '%', background: zoneColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}

      {/* Behavioral causes */}
      {f.causes_text && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Behavioral Causes: </span>
          {f.causes_text}
        </div>
      )}

      {/* Muscle Analysis expandable section */}
      {hasMuscles && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}
          >
            <span style={{ color: 'var(--brand)' }}>Muscle Analysis</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </button>
          {expanded && (
            <div style={{ marginTop: 12, padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: 10 }}>
              <MuscleBodyMap
                tightMuscles={f.tight_muscles || []}
                weakMuscles={f.weak_muscles || []}
                tightLinks={f.tight_muscle_links || []}
                weakLinks={f.weak_muscle_links || []}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Findings Section ----
function FindingsSection({ findings }: { findings: Finding[] }) {
  const grouped = findings.reduce((acc, f) => {
    if (!acc[f.region]) acc[f.region] = []
    acc[f.region].push(f)
    return acc
  }, {} as Record<string, Finding[]>)

  const regions = Object.keys(grouped).sort((a, b) => (REGION_ORDER[a] ?? 99) - (REGION_ORDER[b] ?? 99))

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Detailed Findings
      </h3>
      {regions.map(region => (
        <div key={region} style={{ marginBottom: 16 }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--brand)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {REGION_LABELS[region] ?? region}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {grouped[region].map(f => <FindingCard key={f.id} f={f} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Exercises Section ----
const CATEGORY_LABELS: Record<string, string> = {
  stretch: 'Stretch',
  strengthen: 'Strengthen',
  mobility: 'Mobility',
  activation: 'Activation',
  informational: 'Info',
}
const CATEGORY_COLORS: Record<string, string> = {
  stretch: 'var(--brand)',
  strengthen: 'var(--maintain)',
  mobility: 'var(--warning)',
  activation: '#F472B6',
  informational: 'var(--text-secondary)',
}

function ExerciseAccordionItem({ exercise }: { exercise: ExerciseContent }) {
  const [open, setOpen] = useState(false)
  const catColor = CATEGORY_COLORS[exercise.category] ?? 'var(--brand)'
  const catLabel = CATEGORY_LABELS[exercise.category] ?? exercise.category

  return (
    <div
      data-testid={`exercise-item-${exercise.slug}`}
      style={{
        background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, overflow: 'hidden', marginBottom: 8,
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '14px 16px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 10,
        }}
      >
        <span style={{
          padding: '2px 8px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
          background: `color-mix(in srgb, ${catColor} 13%, transparent)`, color: catColor, textTransform: 'uppercase',
          letterSpacing: '0.05em', flexShrink: 0,
        }}>{catLabel}</span>
        <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          {exercise.name}
        </span>
        <span style={{
          color: 'var(--text-secondary)', fontSize: '0.8rem', transition: 'transform 0.2s',
          display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, margin: '12px 0 10px' }}>
            {exercise.instructions}
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {exercise.sets > 0 && (
              <div style={{ background: 'rgba(0,152,243,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--brand)' }}>{exercise.sets}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sets</div>
              </div>
            )}
            {exercise.dosageType !== 'dynamic' && exercise.holdSeconds > 0 && (
              <div style={{ background: 'rgba(0,152,243,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--brand)' }}>{exercise.holdSeconds}s</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Hold</div>
              </div>
            )}
            {exercise.reps != null && (
              <div style={{ background: 'rgba(0,152,243,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--brand)' }}>{exercise.reps.min}–{exercise.reps.max}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Reps</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExercisesSection({ exercises }: { exercises: ExerciseContent[] }) {
  const [open, setOpen] = useState(true)

  if (exercises.length === 0) return null

  return (
    <details
      data-testid="exercises-section"
      className={styles.disclosure}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Browse all matched exercises <span>{exercises.length}</span></summary>
      <div className={styles.disclosureContent}>
        {exercises.map(ex => (
          <ExerciseAccordionItem key={ex.slug} exercise={ex} />
        ))}
      </div>
    </details>
  )
}

// ---- Main Results Page ----
export default function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assessmentId, setAssessmentId] = useState<string>('')
  const [pdfLoading, setPdfLoading] = useState<'practitioner' | 'client' | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfKind, setPdfKind] = useState<'practitioner' | 'client'>('practitioner')
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [approving, setApproving] = useState(false)
  const [priorAssessments, setPriorAssessments] = useState<Array<{id: string; assessed_at: string; overall_grade: string; scoring_engine_version: string | null}>>([])
  const [compareToId, setCompareToId] = useState<string>('')
  const [auxError, setAuxError] = useState<string | null>(null)
  const [capability, setCapability] = useState<Capability>('standard')
  const [activeKeys, setActiveKeys] = useState<string[] | null>(null)
  const [swaps, setSwaps] = useState<Record<string, Record<string, string>>>({})
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overrideSaveState, setOverrideSaveState] = useState<OverrideSaveState>('idle')
  const [runList, setRunList] = useState<Array<{ session_id: string; created_at: string; status: string; red_flag_acknowledged: boolean | null; completed_at: string | null }>>([])

  const overrideQueue = useMemo(() => assessmentId ? createOverrideQueue(
    (patch) => saveOverridePatch(assessmentId, patch),
    (state) => {
      setOverrideSaveState(state)
      setOverrideError(state === 'failed'
        ? 'Program changes were not saved. Retry the save before approving, exporting, sharing, or launching.'
        : null)
    },
  ) : null, [assessmentId])

  useEffect(() => {
    params.then(p => setAssessmentId(p.id))
  }, [params])

  useEffect(() => {
    if (!assessmentId) return
    // Abort a stale in-flight load when the id changes / the page unmounts, so a
    // slower earlier response can't paint the wrong assessment's data.
    const ac = new AbortController()
    async function load() {
      try {
        const r = await fetch('/api/assessments/' + assessmentId, { signal: ac.signal })
        if (!r.ok) {
          if (r.status === 401) { router.push('/auth/sign-in'); return }
          setError('Assessment not found.')
          setLoading(false)
          return
        }
        const data = await r.json()
        setAssessment(data.assessment)
        setFindings(data.findings || [])
        setCaptures(data.captures || [])
        // Hydrate persisted coach overrides.
        const cap = data.assessment?.capability
        if (cap === 'regression' || cap === 'standard' || cap === 'progression') setCapability(cap)
        setActiveKeys(Array.isArray(data.assessment?.priority_keys) ? data.assessment.priority_keys : null)
        setSwaps(data.assessment?.exercise_swaps && typeof data.assessment.exercise_swaps === 'object' ? data.assessment.exercise_swaps : {})
        if (data.assessment?.clients?.id) {
          const clientId = data.assessment.clients.id
          const priorRes = await fetch('/api/clients/' + clientId + '/assessments?exclude=' + assessmentId + '&approved_only=true', { signal: ac.signal })
          if (priorRes.ok) {
            const priorData = await priorRes.json()
            setPriorAssessments(priorData.assessments || [])
          } else {
            setAuxError('Some report options could not load (prior assessments). Refresh to try again.')
          }
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setError('Failed to load assessment.')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => ac.abort()
  }, [assessmentId, router])

  // Practitioner-facing session-run list (with pain-check status). Refetched on
  // mount; a launched session remounts this page on return from the player.
  useEffect(() => {
    if (!assessmentId) return
    const ac = new AbortController()
    fetch(`/api/workouts?assessment_id=${assessmentId}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setRunList(d.runs ?? []))
      .catch(() => {})
    return () => ac.abort()
  }, [assessmentId])

  const exercises = useMemo(
    () => (findings.length > 0 ? deriveExerciseRecommendations(ALL_EXERCISES, findings) : []),
    [findings]
  )

  const program = useMemo(
    () => buildProgramFrom(findings.map(toEngineFinding), assessment?.overall_grade ?? 'C', { capability, activeKeys, swaps }),
    [findings, assessment?.overall_grade, capability, activeKeys, swaps]
  )
  const unreliableFindings = useMemo(
    () => findings.filter(f => f.zone === 'unreliable').map(f => ({ label: f.label })),
    [findings]
  )
  // Same pure flattener the mint route uses, so the CTA's duration/count match the
  // launched session exactly. null = empty-session floor (nothing reliable to play).
  const sessionPreview = useMemo(() => generateWorkoutSession(program, { week: 1 }), [program])

  // Persist coach overrides so the client PDF regenerates identically. fetch does
  // NOT reject on 4xx/5xx, so a failed save must be detected via the returned ok flag
  // and surfaced — otherwise the optimistic UI (and the PDF rebuilt from the persisted
  // row) silently diverges from the DB with no signal to the practitioner.
  function persistOverrides(patch: OverridePatch) {
    void overrideQueue?.enqueue(patch)
  }

  async function waitForOverrides() {
    if (!overrideQueue) {
      setOverrideError('Program changes cannot be verified yet. Refresh and try again.')
      return false
    }
    const didSave = await overrideQueue.waitForSettled()
    if (!didSave) {
      setOverrideError('Program changes were not saved. Retry the save before approving, exporting, sharing, or launching.')
    }
    return didSave
  }

  async function retryOverrides() {
    if (!overrideQueue) return
    await overrideQueue.retryFailed()
  }

  function handleCapabilityChange(c: Capability) {
    setCapability(c)
    persistOverrides({ capability: c })
  }
  function handleDemote(primaryKey: string) {
    const next = program.priorities.map(p => p.primaryKey).filter(k => k !== primaryKey)
    setActiveKeys(next)
    persistOverrides({ priority_keys: next })
  }
  function handlePromote(primaryKey: string) {
    const order = program.eligibleOrder
    const next = [...program.priorities.map(p => p.primaryKey), primaryKey]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .slice(0, 3)
    setActiveKeys(next)
    persistOverrides({ priority_keys: next })
  }
  function handleSwap(primaryKey: string, baseSlug: string, toSlug: string | null) {
    const nextForPriority = { ...(swaps[primaryKey] ?? {}) }
    if (toSlug === null) delete nextForPriority[baseSlug]
    else nextForPriority[baseSlug] = toSlug
    const next = { ...swaps }
    if (Object.keys(nextForPriority).length === 0) delete next[primaryKey]
    else next[primaryKey] = nextForPriority
    setSwaps(next)
    persistOverrides({ exercise_swaps: next })
  }

  async function handleGeneratePdf(variant: 'practitioner' | 'client' = 'practitioner') {
    if (!assessmentId) return
    if (!(approved || assessment?.practitioner_approved)) {
      setPdfError('Approve the assessment before exporting a report.')
      return
    }
    if (!(await waitForOverrides())) return
    setPdfLoading(variant)
    setPdfError(null)
    setPdfUrl(null)
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, compared_to_assessment_id: compareToId || undefined, variant }),
      })
      if (!r.ok) {
        const err = await r.json()
        setPdfError(err.error || 'PDF generation failed')
        return
      }
      const data = await r.json()
      setPdfKind(variant)
      setPdfUrl(data.signed_url)
    } catch {
      setPdfError('Failed to generate PDF.')
    } finally {
      setPdfLoading(null)
    }
  }

  async function handleApprove() {
    if (!assessmentId) return
    if (!(await waitForOverrides())) return
    setApproving(true)
    try {
      const r = await fetch(`/api/assessments/${assessmentId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      })
      if (r.ok) { setApproved(true); setPdfError(null) }
      else { const e = await r.json().catch(() => ({})); setPdfError(e.error || 'Failed to approve.') }
    } catch {
      setPdfError('Failed to approve.')
    } finally {
      setApproving(false)
    }
  }

  // Mint a guided session from this approved assessment and open the player
  // (in-clinic, same device). The frozen snapshot is generated server-side.
  async function handleLaunch() {
    if (!assessmentId || launching) return
    if (!(await waitForOverrides())) return
    setLaunching(true)
    setLaunchError(null)
    try {
      const r = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setLaunchError(data.error || 'Could not start the session.')
        setLaunching(false)
        return
      }
      if (!data.session_id) {
        setLaunchError('Could not start the session.')
        setLaunching(false)
        return
      }
      router.push(`/workouts/${data.session_id}`)
    } catch {
      setLaunchError('Could not start the session.')
      setLaunching(false)
    }
  }

  // Mint an expiring, hashed public share link so the client can follow the same
  // guided session from their own device (O5). The raw token lives only in the
  // returned URL — never stored — so this is the one moment it exists to copy.
  async function handleShare() {
    if (!assessmentId || sharing) return
    if (!(await waitForOverrides())) return
    setSharing(true)
    setShareError(null)
    setCopied(false)
    try {
      const r = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, share: true }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.share_link) {
        setShareError(data.error || 'Could not create a share link.')
        setSharing(false)
        return
      }
      setShareLink(data.share_link)
      setSharing(false)
    } catch {
      setShareError('Could not create a share link.')
      setSharing(false)
    }
  }

  async function copyShareLink() {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, border: '4px solid rgba(0,152,243,0.2)', borderTop: '4px solid var(--brand)', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        <p style={{ color: 'var(--text-secondary)' }}>Loading results...</p>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error || 'Assessment not found.'}</p>
        <Link href="/clients" style={{ color: 'var(--brand)', textDecoration: 'none' }}>Back to Clients</Link>
      </div>
    )
  }

  const grade = assessment.overall_grade
  const score = assessment.overall_score
  // Percentile intentionally suppressed (O2): `overall_percentile` is a self-labeled
  // rough linear transform, not a population rank, so we show the grade band instead
  // of a dishonest "Top X%" until a real normative cohort exists.
  const gradeDesc = GRADE_BANDS.find(b => b.grade === grade)?.desc ?? 'Screening'
  const color = gradeColor(grade)
  const isApproved = approved || !!assessment.practitioner_approved
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name
  const frontCapture = captures.find(c => c.view === 'front') ?? null
  // A per-side assessment now returns two `side` captures; pick deterministically
  // (left, then right, then any) instead of arbitrary array order. Legacy single
  // side rows carry a null profile_side and fall through to the first side row.
  const sideCaptures = captures.filter(c => c.view === 'side')
  const sideCapture =
    sideCaptures.find(c => c.profile_side === 'left')
    ?? sideCaptures.find(c => c.profile_side === 'right')
    ?? sideCaptures[0] ?? null
  const rollNotes = captures
    .filter(c => typeof c.capture_roll_deg === 'number' && Math.abs(c.capture_roll_deg) >= 0.05)
    .map(c => `${c.view} ${c.capture_roll_deg! > 0 ? '+' : '−'}${Math.abs(c.capture_roll_deg!).toFixed(1)}°`)
  const assessedAtLabel = new Date(assessment.assessed_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const reliabilityLabel = assessment.level_verified === true
    ? 'Camera level verified'
    : assessment.level_verified === false
      ? 'Camera level not verified'
      : 'Camera level unavailable'
  const reliabilityDetailParts = [
    typeof assessment.capture_stability === 'number'
      ? `Capture stability ${Math.round(assessment.capture_stability * 100)}%`
      : null,
    assessment.tilt_corrected && rollNotes.length > 0
      ? `Tilt corrected: ${rollNotes.join(', ')}`
      : null,
  ].filter((part): part is string => part !== null)
  const comparisonOptions = priorAssessments.map((prior) => ({
    id: prior.id,
    label: `${new Date(prior.assessed_at).toLocaleDateString()} — Grade ${prior.overall_grade}${
      prior.scoring_engine_version !== assessment.scoring_engine_version || prior.scoring_engine_version === null
        ? ' (different scoring version)'
        : ''
    }`,
  }))

  return (
    <div className={styles.reviewPage}>
      <Link className={styles.backLink} href={`/clients/${assessment.clients.id}`}>← Back to client</Link>

      <header className={styles.studioHeader}>
        <p className="app-page-kicker">Screening review</p>
        <h1>Assessment review studio</h1>
        <p>Verify the evidence, tune the corrective program, and release the next safe practitioner action.</p>
        {typeof assessment.level_verified === 'boolean' && (
          <span className={styles.levelBadge} data-testid="level-badge" data-verified={assessment.level_verified ? 'true' : 'false'}>
            {assessment.level_verified ? 'Camera level verified' : 'Camera level not verified — results may be less accurate'}
          </span>
        )}
      </header>

      <div className={styles.studioGrid}>
        <ReviewDock
          clientName={clientName}
          assessedAtLabel={assessedAtLabel}
          grade={grade}
          score={score}
          reliabilityLabel={reliabilityLabel}
          reliabilityDetail={reliabilityDetailParts.join(' · ') || null}
          unreliableCount={unreliableFindings.length}
          isApproved={isApproved}
          saveState={overrideSaveState}
          hasSession={sessionPreview !== null}
          isApproving={approving}
          isLaunching={launching}
          onApprove={handleApprove}
          onLaunch={handleLaunch}
          onRetrySave={retryOverrides}
          pdfLoading={pdfLoading}
          pdfUrl={pdfUrl}
          pdfKind={pdfKind}
          onGeneratePdf={handleGeneratePdf}
          comparisonId={compareToId}
          comparisonOptions={comparisonOptions}
          onComparisonChange={setCompareToId}
          isSharing={sharing}
          shareLink={shareLink}
          copied={copied}
          onShare={handleShare}
          onCopyShare={copyShareLink}
          backHref={`/clients/${assessment.clients.id}`}
          newAssessmentHref="/assessments/new"
        />

        <div className={styles.canvas}>
          <section id="review-summary" className={styles.canvasSection} aria-labelledby="review-summary-heading">
            <h2 id="review-summary-heading" className={styles.sectionHeading}>Summary</h2>
            <div data-testid="disclaimer" className={styles.screeningNotice}>
              Posture AI is a <strong>screening tool only</strong> — results are informational and educational, not a substitute for evaluation by a qualified professional.
            </div>
            <div className={styles.ratingSummary}>
              <GradeRing grade={grade} score={score} />
              <div>
                <strong>{gradeDesc} posture</strong>
                <p>Deviation: {score}/100 (lower is better) — Grade <span style={{ color }}>{grade}</span></p>
                <ScoreBar score={score} grade={grade} />
              </div>
            </div>
            <BandTable currentGrade={grade} />

            <div className={styles.sessionSummary}>
              {sessionPreview ? (
                <div>
                  <strong>Guided corrective session ready</strong>
                  <p>{sessionPreview.items.length} movements · about {Math.max(1, Math.round(sessionPreview.estimatedDurationSec / 60))} min · full-screen coach</p>
                  {!isApproved && <p>Practitioner approval is required before launch.</p>}
                </div>
              ) : (
                <div>
                  <strong>No guided session available</strong>
                  <p>There are not enough reliably measured findings. Re-capture clear front and side photos to build a session.</p>
                </div>
              )}
            </div>

            {runList.length > 0 && (
              <div className={styles.runList}>
                <h3>Session runs</h3>
                {runList.map((run) => (
                  <div key={run.session_id + run.created_at}>
                    <span>{new Date(run.created_at).toLocaleDateString()}</span>
                    <span>{run.status.replace('_', ' ')}</span>
                    <span>{run.red_flag_acknowledged ? 'Pain check: clear' : 'Pain check: not recorded'}</span>
                  </div>
                ))}
              </div>
            )}

            {[launchError, shareError, pdfError, auxError].filter(Boolean).map((message) => (
              <p key={message} className={styles.inlineAlert} role="alert">{message}</p>
            ))}
            <AccuracyCard assessment={assessment} findings={findings} />
          </section>

          <section id="review-program" className={styles.canvasSection} aria-labelledby="review-program-heading">
            <h2 id="review-program-heading" className={styles.sectionHeading}>Program</h2>
            {findings.length > 0 ? (
              <PriorityProgram
                report={program}
                unreliable={unreliableFindings}
                capability={capability}
                onCapabilityChange={handleCapabilityChange}
                onDemote={handleDemote}
                onPromote={handlePromote}
                onSwap={handleSwap}
              />
            ) : (
              <p className={styles.emptyState}>No corrective priorities are available from this screening.</p>
            )}
            {overrideSaveState === 'saving' && <p role="status" aria-live="polite" className={styles.inlineStatus}>Saving program changes…</p>}
            {overrideError && <p role="alert" aria-live="assertive" className={styles.inlineAlert}>{overrideError}</p>}
          </section>

          <section id="review-alignment" className={styles.canvasSection} aria-labelledby="review-alignment-heading">
            <h2 id="review-alignment-heading" className={styles.sectionHeading}>Alignment evidence</h2>
            <SkeletalDiagramSection findings={findings} frontCapture={frontCapture} sideCapture={sideCapture} />
            {findings.length > 0 && <MuscleModel3D findings={findings} />}
          </section>

          <section id="review-findings" className={styles.canvasSection} aria-labelledby="review-findings-heading">
            <h2 id="review-findings-heading" className={styles.sectionHeading}>Findings</h2>
            {findings.length > 0
              ? <FindingsSection findings={findings} />
              : <p className={styles.emptyState}>No findings were recorded for this screening.</p>}
          </section>

          <section id="review-library" className={styles.canvasSection} aria-labelledby="review-library-heading">
            <h2 id="review-library-heading" className={styles.sectionHeading}>Exercise library</h2>
            {exercises.length > 0
              ? <ExercisesSection exercises={exercises} />
              : <p className={styles.emptyState}>No matched exercise references are available.</p>}
            <p className={styles.screeningFooter}><strong>Screening tool only.</strong> Exercise suggestions are for practitioner review, not medical orders.</p>
          </section>
        </div>
      </div>
    </div>
  )
}

// The visible payoff of the engine-credibility layer: per-finding within-capture
// stability + angle uncertainty, capture/level status, and an honest statement of
// the 2D monocular limits. No population percentile (O2) — nothing here overclaims.
function AccuracyCard({ assessment, findings }: { assessment: Assessment; findings: Finding[] }) {
  const withStability = findings.filter(
    f => f.zone !== 'unreliable' && (f.stability_score != null || f.uncertainty_deg != null),
  )
  const pill = (ok: boolean, label: string) => (
    <span style={{
      padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
      background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(255,137,24,0.12)',
      color: ok ? 'var(--maintain)' : 'var(--warning)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(255,137,24,0.3)'}`,
    }}>{label}</span>
  )
  return (
    <div data-testid="accuracy-card" style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--glass-border)' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accuracy &amp; Methodology</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.55, margin: '0 0 16px' }}>
        A single-photo <strong style={{ color: 'var(--text-secondary)' }}>2D screening</strong> (BlazePose, 33 landmarks) — no depth, so monocular parallax and camera tilt can affect angles. &ldquo;Stability&rdquo; shows how consistent each measurement was across the multi-frame capture burst, not a clinical-accuracy guarantee.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: withStability.length ? 16 : 0 }}>
        {pill(assessment.level_verified === true, assessment.level_verified === true ? 'Camera level verified' : 'Level not verified')}
        {assessment.tilt_corrected ? pill(true, 'Tilt-corrected') : null}
        {typeof assessment.capture_stability === 'number' ? pill(assessment.capture_stability >= 0.7, `Capture stability ${Math.round(assessment.capture_stability * 100)}%`) : null}
      </div>
      {withStability.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {withStability.map(f => {
            const s = f.stability_score
            const stColor = s == null ? 'var(--text-secondary)' : s >= 0.8 ? 'var(--maintain)' : s >= 0.6 ? 'var(--warning)' : 'var(--danger)'
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flex: 1 }}>{f.label}</span>
                {f.uncertainty_deg != null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>±{f.uncertainty_deg.toFixed(1)}°</span>}
                {s != null && <span style={{ color: stColor, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(s * 100)}% stable</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
