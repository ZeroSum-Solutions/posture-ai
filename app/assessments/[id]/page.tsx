'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PriorityProgram from './PriorityProgram'
import MuscleBodyMap from './MuscleBodyMap'
import MuscleModel3D from './MuscleModel3D'
import { hasAnyMuscle, type MuscleLink } from './muscleMap'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import type { Capability } from '@/lib/program/selectPriorities'
import { toEngineFinding } from '@/lib/findings/storedFindingToEngine'
import { generateWorkoutSession } from '@/lib/workout/generateWorkoutSession'

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
  signed_url: string | null
  source: string
  capture_roll_deg: number | null
}
interface Exercise {
  id: string
  slug: string
  name: string
  category: string
  primary_deviation_keys: string[]
  min_zone: string
  instructions: string
  sets: number
  hold_seconds: number
  reps_min?: number | null
  reps_max?: number | null
  dosage_type?: string | null
  is_integrative?: boolean | null
}

const ZONE_ORDER: Record<string, number> = { maintain: 0, warning: 1, danger: 2, unreliable: -1 }
function zoneAtOrAbove(findingZone: string, minZone: string): boolean {
  return (ZONE_ORDER[findingZone] ?? -1) >= (ZONE_ORDER[minZone] ?? 0)
}
function deriveExerciseRecommendations(exercises: Exercise[], findings: Finding[]): Exercise[] {
  const reliableFindings = findings.filter(f => f.zone !== 'unreliable')
  return exercises.filter(ex =>
    ex.primary_deviation_keys.some(key => {
      const finding = reliableFindings.find(f => f.imbalance_key === key)
      return finding && zoneAtOrAbove(finding.zone, ex.min_zone)
    })
  )
}

interface Assessment {
  id: string
  status: string
  overall_score: number
  overall_grade: OverallGrade
  overall_percentile: number | null
  front_rank: number | null
  side_rank: number | null
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
  if (grade === 'S' || grade === 'A') return '#22C55E'
  if (grade === 'B' || grade === 'C') return '#F59E0B'
  return '#EF4444'
}

// Zone colors
const ZONE_COLORS: Record<Zone, string> = {
  maintain: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  unreliable: '#71717A',
}

// Band reference table
const GRADE_BANDS = [
  { grade: 'S', range: '0–5', desc: 'Elite', color: '#22C55E' },
  { grade: 'A', range: '5–15', desc: 'Excellent', color: '#22C55E' },
  { grade: 'B', range: '15–50', desc: 'Good', color: '#F59E0B' },
  { grade: 'C', range: '50–85', desc: 'Fair', color: '#F59E0B' },
  { grade: 'D', range: '85–95', desc: 'Poor', color: '#EF4444' },
  { grade: 'E', range: '95–100', desc: 'Critical', color: '#EF4444' },
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
      <circle cx={x} cy={y} r={r + 4} fill={color + '18'} stroke={color} strokeWidth="1.5" strokeDasharray="3,2"/>
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
      markerEnd={`url(#arrow-${color.replace('#', '')})`}
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
          {uniqueColors.map(color => (
            <marker key={color} id={`arrow-${color.replace('#', '')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color}/>
            </marker>
          ))}
        </defs>
        <circle cx="90" cy="26" r="20" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <line x1="90" y1="46" x2="90" y2="62" stroke="#3F3F46" strokeWidth="2.5"/>
        <line x1="48" y1="62" x2="132" y2="62" stroke="#3F3F46" strokeWidth="3"/>
        <line x1="48" y1="62" x2="28" y2="132" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="28" y1="132" x2="16" y2="190" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="132" y1="62" x2="152" y2="132" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="152" y1="132" x2="164" y2="190" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="90" y1="62" x2="90" y2="218" stroke="#3F3F46" strokeWidth="2.5"/>
        <path d="M 90 80 Q 62 95 58 120" stroke="#3F3F46" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <path d="M 90 80 Q 118 95 122 120" stroke="#3F3F46" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <line x1="62" y1="218" x2="118" y2="218" stroke="#3F3F46" strokeWidth="3"/>
        <line x1="62" y1="218" x2="58" y2="305" stroke="#3F3F46" strokeWidth="2.5"/>
        <line x1="118" y1="218" x2="122" y2="305" stroke="#3F3F46" strokeWidth="2.5"/>
        <circle cx="58" cy="305" r="5" stroke="#3F3F46" strokeWidth="2" fill="#161618"/>
        <circle cx="122" cy="305" r="5" stroke="#3F3F46" strokeWidth="2" fill="#161618"/>
        <line x1="58" y1="310" x2="56" y2="390" stroke="#3F3F46" strokeWidth="2.5"/>
        <line x1="122" y1="310" x2="124" y2="390" stroke="#3F3F46" strokeWidth="2.5"/>
        <line x1="42" y1="392" x2="68" y2="392" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="112" y1="392" x2="138" y2="392" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="90" y1="0" x2="90" y2="410" stroke="rgba(99,102,241,0.2)" strokeWidth="1" strokeDasharray="4,4"/>
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
          {uniqueColors.map(color => (
            <marker key={color} id={`arrow-side-${color.replace('#', '')}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color}/>
            </marker>
          ))}
        </defs>
        <circle cx="80" cy="26" r="20" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <path d="M 75 46 Q 70 54 68 62" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <path d="M 68 62 Q 64 80 62 100" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <line x1="68" y1="62" x2="88" y2="120" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="88" y1="120" x2="95" y2="178" stroke="#3F3F46" strokeWidth="2"/>
        <path d="M 62 100 Q 58 135 60 165" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <path d="M 60 165 Q 64 192 66 218" stroke="#3F3F46" strokeWidth="2.5" fill="none"/>
        <path d="M 66 218 Q 72 228 70 238" stroke="#3F3F46" strokeWidth="3" fill="none"/>
        <line x1="70" y1="238" x2="72" y2="305" stroke="#3F3F46" strokeWidth="2.5"/>
        <circle cx="72" cy="305" r="5" stroke="#3F3F46" strokeWidth="2" fill="#161618"/>
        <line x1="72" y1="310" x2="74" y2="390" stroke="#3F3F46" strokeWidth="2.5"/>
        <line x1="60" y1="390" x2="100" y2="390" stroke="#3F3F46" strokeWidth="2"/>
        <line x1="72" y1="0" x2="72" y2="410" stroke="rgba(99,102,241,0.2)" strokeWidth="1" strokeDasharray="4,4"/>
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
    <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Postural Alignment Diagram
      </h2>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Front View</div>
          <FrontSkeleton findings={findings} captureUrl={frontCapture?.signed_url ?? null}/>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#8A8A93', fontWeight: 500 }}>{viewFindingsLabel('front')}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Side View</div>
          <SideSkeleton findings={findings} captureUrl={sideCapture?.signed_url ?? null}/>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#8A8A93', fontWeight: 500 }}>{viewFindingsLabel('side')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center', marginTop: 20 }}>
        {[{ color: '#22C55E', label: 'Maintain' }, { color: '#F59E0B', label: 'Warning' }, { color: '#EF4444', label: 'Danger' }].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }}/>
            <span style={{ fontSize: '0.72rem', color: '#A1A1AA' }}>{label}</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 14, fontSize: '0.68rem', color: '#A1A1AA', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
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
        background: 'linear-gradient(to right, #22C55E 0%, #22C55E 15%, #F59E0B 50%, #EF4444 85%, #EF4444 100%)',
        marginBottom: 8 }}>
        <div style={{ position: 'absolute', left: positionPct + '%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 18, height: 18, borderRadius: '50%', background: color, border: '3px solid #0A0A0B',
          boxShadow: '0 0 8px ' + color + '88' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#8A8A93' }}>
        <span style={{ color: '#22C55E' }}>S (Best)</span>
        <span>Deviation: {score}</span>
        <span style={{ color: '#EF4444' }}>E (Worst)</span>
      </div>
    </div>
  )
}

function BandTable({ currentGrade }: { currentGrade: OverallGrade }) {
  return (
    <div>
      <h3 style={{ fontSize: '0.78rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Grade Reference</h3>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {GRADE_BANDS.map(b => (
          <div key={b.grade} style={{ padding: '6px 10px', borderRadius: 8,
            background: b.grade === currentGrade ? b.color + '22' : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (b.grade === currentGrade ? b.color : 'rgba(255,255,255,0.08)'),
            textAlign: 'center', minWidth: 56 }}>
            <div style={{ fontSize: '1rem', fontWeight: 900, color: b.color }}>{b.grade}</div>
            <div style={{ fontSize: '0.68rem', color: '#A1A1AA', marginTop: 1 }}>{b.range}</div>
            <div style={{ fontSize: '0.65rem', color: '#A1A1AA' }}>{b.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Finding Card ----
function FindingCard({ f }: { f: Finding }) {
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
        background: isUnreliable ? '#111113' : '#161618',
        border: '1px solid ' + (isUnreliable ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)'),
        borderRadius: 12, padding: 16,
        borderLeft: '3px solid ' + zoneColor,
        opacity: isUnreliable ? 0.65 : 1,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontWeight: 600, color: isUnreliable ? '#A1A1AA' : '#F5F5F5', fontSize: '0.9rem' }}>
          {f.label}
          <span style={{ marginLeft: 8, fontSize: '0.78rem', color: '#8A8A93' }}>({f.view_used} view)</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isUnreliable && (
            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
              background: 'rgba(113,113,122,0.2)', color: '#8A8A93', border: '1px solid rgba(113,113,122,0.4)',
              textTransform: 'uppercase' }}>Unreliable</span>
          )}
          <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
            background: zoneColor + '22', color: isUnreliable ? '#A1A1AA' : zoneColor, textTransform: 'uppercase' }}>{f.zone}</span>
          {f.borderline ? (
            <span title="This reading sits within its own capture variability of a zone boundary — consider the zone as approximate."
              style={{ fontSize: 11, opacity: 0.8, marginLeft: 6 }}>
              ± borderline
            </span>
          ) : null}
        </div>
      </div>

      {/* Deviation */}
      <div style={{ fontSize: '0.875rem', color: isUnreliable ? '#A1A1AA' : '#D4D4D8', marginBottom: 10 }}>
        <strong>{Number(f.deviation).toFixed(1)}&deg;</strong> deviation from 0&deg; standard
        {f.direction && f.direction !== 'Neutral' && f.direction !== 'Level' && (
          <span style={{ color: '#A1A1AA' }}> — {f.direction}</span>
        )}
      </div>

      {/* Severity bar */}
      {!isUnreliable && (
        <div style={{ marginBottom: f.causes_text ? 12 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.72rem', color: '#8A8A93' }}>Severity</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, color: zoneColor }}>{f.severity_pct}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: f.severity_pct + '%', background: zoneColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}

      {/* Behavioral causes */}
      {f.causes_text && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: '0.8rem', color: '#A1A1AA', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: '#8A8A93', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Behavioral Causes: </span>
          {f.causes_text}
        </div>
      )}

      {/* Muscle Analysis expandable section */}
      {hasMuscles && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '6px 12px', cursor: 'pointer',
              color: '#A1A1AA', fontSize: '0.75rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            }}
          >
            <span style={{ color: '#818CF8' }}>Muscle Analysis</span>
            <span style={{ marginLeft: 'auto', color: '#A1A1AA', transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
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
      <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Detailed Findings
      </h2>
      {regions.map(region => (
        <div key={region} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#818CF8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {REGION_LABELS[region] ?? region}
          </h3>
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
  stretch: '#818CF8',
  strengthen: '#22C55E',
  mobility: '#F59E0B',
  activation: '#F472B6',
  informational: '#A1A1AA',
}

function ExerciseAccordionItem({ exercise }: { exercise: Exercise }) {
  const [open, setOpen] = useState(false)
  const catColor = CATEGORY_COLORS[exercise.category] ?? '#6366F1'
  const catLabel = CATEGORY_LABELS[exercise.category] ?? exercise.category

  return (
    <div
      data-testid={`exercise-item-${exercise.slug}`}
      style={{
        background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
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
          background: catColor + '22', color: catColor, textTransform: 'uppercase',
          letterSpacing: '0.05em', flexShrink: 0,
        }}>{catLabel}</span>
        <span style={{ flex: 1, fontWeight: 600, color: '#F5F5F5', fontSize: '0.9rem' }}>
          {exercise.name}
        </span>
        <span style={{
          color: '#A1A1AA', fontSize: '0.8rem', transition: 'transform 0.2s',
          display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ color: '#D4D4D8', fontSize: '0.875rem', lineHeight: 1.6, margin: '12px 0 10px' }}>
            {exercise.instructions}
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {exercise.sets > 0 && (
              <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#818CF8' }}>{exercise.sets}</div>
                <div style={{ fontSize: '0.7rem', color: '#A1A1AA', textTransform: 'uppercase' }}>Sets</div>
              </div>
            )}
            {exercise.dosage_type !== 'dynamic' && exercise.hold_seconds > 0 && (
              <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#818CF8' }}>{exercise.hold_seconds}s</div>
                <div style={{ fontSize: '0.7rem', color: '#A1A1AA', textTransform: 'uppercase' }}>Hold</div>
              </div>
            )}
            {exercise.reps_min != null && exercise.reps_max != null && (
              <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#818CF8' }}>{exercise.reps_min}–{exercise.reps_max}</div>
                <div style={{ fontSize: '0.7rem', color: '#A1A1AA', textTransform: 'uppercase' }}>Reps</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExercisesSection({ exercises }: { exercises: Exercise[] }) {
  if (exercises.length === 0) return null

  return (
    <div data-testid="exercises-section" style={{ marginBottom: 24 }}>
      <h2 style={{
        fontSize: '0.875rem', fontWeight: 600, color: '#A1A1AA',
        marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        All Matched Exercises (library reference)
      </h2>
      {exercises.map(ex => (
        <ExerciseAccordionItem key={ex.id} exercise={ex} />
      ))}
    </div>
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
  const [priorAssessments, setPriorAssessments] = useState<Array<{id: string; assessed_at: string; overall_grade: string}>>([])
  const [compareToId, setCompareToId] = useState<string>('')
  const [allExercises, setAllExercises] = useState<Exercise[]>([])
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
            setAuxError('Some report options could not load (prior assessments or exercises). Refresh to try again.')
          }
        }
        // Fetch exercises
        const exRes = await fetch('/api/exercises', { signal: ac.signal })
        if (exRes.ok) {
          const exData = await exRes.json()
          setAllExercises(exData.exercises || [])
        } else {
          setAuxError('Some report options could not load (prior assessments or exercises). Refresh to try again.')
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

  const exercises = useMemo(
    () => (allExercises.length > 0 && findings.length > 0 ? deriveExerciseRecommendations(allExercises, findings) : []),
    [allExercises, findings]
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

  // Serialize override PATCHes: rapid edits (reorder, then swap) must reach the
  // server in call order, or a slower earlier write could land last and overwrite
  // the newer state. Each call chains onto the previous one's completion.
  const overrideQueue = useRef<Promise<void>>(Promise.resolve())

  // Persist coach overrides so the client PDF regenerates identically.
  function persistOverrides(patch: { capability?: Capability; priority_keys?: string[] | null; exercise_swaps?: Record<string, Record<string, string>> }) {
    if (!assessmentId) return
    overrideQueue.current = overrideQueue.current.then(async () => {
      try {
        await fetch('/api/assessments/' + assessmentId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      } catch {
        // Non-blocking: the UI already reflects the change; a failed save retries on next edit.
      }
    })
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
        <div style={{ width: 48, height: 48, border: '4px solid rgba(99,102,241,0.2)', borderTop: '4px solid #6366F1', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 1s linear infinite' }} />
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        <p style={{ color: '#A1A1AA' }}>Loading results...</p>
      </div>
    )
  }

  if (error || !assessment) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: '#EF4444', marginBottom: 16 }}>{error || 'Assessment not found.'}</p>
        <Link href="/clients" style={{ color: '#818CF8', textDecoration: 'none' }}>Back to Clients</Link>
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
  const sideCapture = captures.find(c => c.view === 'side') ?? null
  const rollNotes = captures
    .filter(c => typeof c.capture_roll_deg === 'number' && Math.abs(c.capture_roll_deg) >= 0.05)
    .map(c => `${c.view} ${c.capture_roll_deg! > 0 ? '+' : '−'}${Math.abs(c.capture_roll_deg!).toFixed(1)}°`)

  return (
    <div style={{ padding: '24px 16px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <Link href={'/clients/' + assessment.clients.id}
          style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          ← Back to {clientName}
        </Link>
      </div>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', margin: '0 0 4px' }}>Assessment Results</h1>
        <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
          {clientName} — {new Date(assessment.assessed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        {assessment.level_verified === true && (
          <span data-testid="level-badge" style={{
            display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
            color: '#34D399', fontSize: '0.75rem', fontWeight: 600,
          }}>
            Camera level verified
            {assessment.tilt_corrected && rollNotes.length > 0 && ` — tilt-corrected (${rollNotes.join(', ')})`}
          </span>
        )}
        {assessment.level_verified === false && (
          <span data-testid="level-badge" style={{
            display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 6,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#F59E0B', fontSize: '0.75rem', fontWeight: 600,
          }}>
            ⚠ Camera level not verified — results may be less accurate
          </span>
        )}
      </div>

      <div data-testid="disclaimer" style={{
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontSize: '0.8rem', color: '#D4D4D8', lineHeight: 1.5 }}>
        Posture AI is a <strong style={{ color: '#818CF8' }}>screening tool only</strong> — results are for informational and educational purposes and are not a substitute for evaluation by a qualified professional. Consult a qualified health professional before making any clinical decisions.
      </div>

      <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#A1A1AA', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Overall Rating
        </h2>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }}>
          <GradeRing grade={grade} score={score} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: 4 }}>{gradeDesc} posture</div>
            <div style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: 16 }}>
              Deviation: {score}/100 (lower is better) — Grade <span style={{ color, fontWeight: 700 }}>{grade}</span>
            </div>
            <ScoreBar score={score} grade={grade} />
          </div>
        </div>
        <BandTable currentGrade={grade} />
      </div>

      {/* Launch guided session (in-clinic) — the headline corrective action */}
      {sessionPreview ? (
        <div style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.16), rgba(34,197,94,0.07))',
          border: '1px solid rgba(99,102,241,0.32)', borderRadius: 16, padding: 20, marginBottom: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#F5F5F5', marginBottom: 4 }}>Guided corrective session</div>
            <div style={{ color: '#A1A1AA', fontSize: '0.85rem' }}>
              {sessionPreview.items.length} movements · ≈ {Math.max(1, Math.round(sessionPreview.estimatedDurationSec / 60))} min · full-screen coach
            </div>
            {!isApproved && <div style={{ color: '#F59E0B', fontSize: '0.78rem', marginTop: 6 }}>Approve the assessment below to launch.</div>}
            {launchError && <div role="alert" style={{ color: '#F87171', fontSize: '0.8rem', marginTop: 6 }}>{launchError}</div>}
          </div>
          <button
            onClick={handleLaunch}
            disabled={!isApproved || launching}
            data-testid="launch-session"
            style={{
              padding: '0 30px', minHeight: 56, borderRadius: 999, border: 'none',
              background: isApproved && !launching ? '#6366F1' : 'rgba(99,102,241,0.25)',
              color: '#fff', fontWeight: 800, fontSize: '1rem',
              cursor: isApproved && !launching ? 'pointer' : 'not-allowed',
              boxShadow: isApproved && !launching ? '0 10px 28px rgba(99,102,241,0.4)' : 'none', whiteSpace: 'nowrap',
            }}
          >
            {launching ? 'Starting…' : <><span aria-hidden="true">▶ </span>Launch session</>}
          </button>
          <div style={{ flexBasis: '100%', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14, marginTop: 2 }}>
            {shareLink ? (
              <div>
                <div style={{ color: '#A1A1AA', fontSize: '0.78rem', marginBottom: 6 }}>
                  Client link — expires in 14 days. Send it only to this client.
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    readOnly
                    value={shareLink}
                    data-testid="share-link"
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      flex: 1, minWidth: 200, minHeight: 40, padding: '0 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.14)', background: '#0E0E10',
                      color: '#E4E4E7', fontSize: '0.8rem', fontFamily: 'monospace',
                    }}
                  />
                  <button
                    onClick={copyShareLink}
                    style={{
                      minHeight: 40, padding: '0 16px', borderRadius: 8, border: '1px solid rgba(129,140,248,0.5)',
                      background: 'transparent', color: '#818CF8', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleShare}
                disabled={!isApproved || sharing}
                data-testid="share-session"
                style={{
                  minHeight: 44, padding: '0 18px', borderRadius: 999,
                  border: '1px solid rgba(129,140,248,0.5)', background: 'transparent',
                  color: isApproved ? '#818CF8' : '#52525B', fontWeight: 700, fontSize: '0.9rem',
                  cursor: isApproved && !sharing ? 'pointer' : 'not-allowed',
                }}
              >
                {sharing ? 'Creating link…' : '🔗 Share with client'}
              </button>
            )}
            {shareError && <div role="alert" style={{ color: '#F87171', fontSize: '0.8rem', marginTop: 6 }}>{shareError}</div>}
          </div>
        </div>
      ) : (
        <div style={{ background: '#161618', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
          <div style={{ fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>No guided session yet</div>
          <div style={{ color: '#A1A1AA', fontSize: '0.85rem', lineHeight: 1.5 }}>
            There aren&apos;t enough reliably-measured findings to build a corrective session. Re-capture clear front &amp; side photos and try again.
          </div>
        </div>
      )}

      <AccuracyCard assessment={assessment} findings={findings} />

      {findings.length > 0 && (
        <PriorityProgram
          report={program}
          unreliable={unreliableFindings}
          capability={capability}
          onCapabilityChange={handleCapabilityChange}
          onDemote={handleDemote}
          onPromote={handlePromote}
          onSwap={handleSwap}
        />
      )}

      <SkeletalDiagramSection
        findings={findings}
        frontCapture={frontCapture}
        sideCapture={sideCapture}
      />

      {findings.length > 0 && <MuscleModel3D findings={findings} />}

      {findings.length > 0 && <FindingsSection findings={findings} />}

      <ExercisesSection exercises={exercises} />

      <div style={{
        background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: 10, padding: '12px 16px', fontSize: '0.78rem', color: '#8A8A93', lineHeight: 1.5, marginBottom: 24 }}>
        <strong style={{ color: '#EF4444' }}>SCREENING TOOL ONLY.</strong> These findings are for educational and informational purposes only. Always consult a qualified health professional for evaluation and clinical decisions.
      </div>

      {pdfUrl && (
        <div style={{ background: '#161618', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: '#22C55E', fontSize: '0.875rem', marginBottom: 8 }}>
            {pdfKind === 'client' ? 'Client report' : 'Practitioner report'} generated successfully.
          </p>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 20px', borderRadius: 8, background: '#4F46E5',
            color: '#fff', fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none', display: 'inline-block' }}>
            Download {pdfKind === 'client' ? 'Client Report' : 'Practitioner PDF'}
          </a>
        </div>
      )}
      {pdfError && <div role="alert" style={{ color: '#EF4444', fontSize: '0.875rem', marginBottom: 16 }}>{pdfError}</div>}
      {auxError && <div role="alert" style={{ color: '#F87171', fontSize: '0.85rem', marginBottom: 16 }}>{auxError}</div>}

      {priorAssessments.length > 0 && (
        <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <label htmlFor="compare-prior" style={{ fontSize: '0.8rem', color: '#A1A1AA', display: 'block', marginBottom: 8 }}>
            Compare PDF to prior assessment (optional):
          </label>
          <select id="compare-prior" aria-label="Compare PDF to prior assessment" value={compareToId} onChange={e => setCompareToId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.15)',
              color: '#F5F5F5', fontSize: '0.875rem', width: '100%', cursor: 'pointer' }}>
            <option value="">No comparison (single assessment)</option>
            {priorAssessments.map(a => (
              <option key={a.id} value={a.id}>
                {new Date(a.assessed_at).toLocaleDateString()} — Grade {a.overall_grade}
              </option>
            ))}
          </select>
        </div>
      )}

      {(() => {
        const isApproved = approved || !!assessment.practitioner_approved
        return (
          <div style={{
            background: isApproved ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
            border: '1px solid ' + (isApproved ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'),
            borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.85rem', color: '#D4D4D8' }}>
              {isApproved
                ? '✓ Reviewed & approved by practitioner — report export enabled.'
                : 'Review these findings, then approve to enable report export. Exercises are suggestions for the practitioner to apply, not medical orders.'}
            </span>
            {!isApproved && (
              <button onClick={handleApprove} disabled={approving} style={{
                padding: '9px 16px', borderRadius: 8, background: '#F59E0B', color: '#1A1205',
                border: 'none', fontWeight: 700, fontSize: '0.85rem', cursor: approving ? 'not-allowed' : 'pointer',
              }}>{approving ? 'Approving…' : 'Approve report'}</button>
            )}
          </div>
        )
      })()}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href={'/clients/' + assessment.clients.id} style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.06)',
          color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>Back to Client</Link>
        <button onClick={() => handleGeneratePdf('practitioner')} disabled={pdfLoading !== null}
          style={{ padding: '12px 24px', borderRadius: 10,
            background: pdfLoading !== null ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.15)',
            color: pdfLoading !== null ? '#6366F1aa' : '#6366F1',
            border: '1px solid rgba(99,102,241,0.3)',
            fontWeight: 600, fontSize: '0.9rem', cursor: pdfLoading !== null ? 'not-allowed' : 'pointer', minHeight: 44 }}>
          {pdfLoading === 'practitioner' ? 'Generating PDF...' : 'Practitioner PDF'}
        </button>
        <button onClick={() => handleGeneratePdf('client')} disabled={pdfLoading !== null}
          style={{ padding: '12px 24px', borderRadius: 10,
            background: pdfLoading !== null ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.15)',
            color: pdfLoading !== null ? '#22C55Eaa' : '#22C55E',
            border: '1px solid rgba(34,197,94,0.3)',
            fontWeight: 600, fontSize: '0.9rem', cursor: pdfLoading !== null ? 'not-allowed' : 'pointer', minHeight: 44 }}>
          {pdfLoading === 'client' ? 'Generating…' : 'Client Report'}
        </button>
        <Link href="/assessments/new" style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
          color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.08)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>New Assessment</Link>
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
      background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
      color: ok ? '#34D399' : '#F59E0B',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
    }}>{label}</span>
  )
  return (
    <div data-testid="accuracy-card" style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#A1A1AA', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accuracy &amp; Methodology</h2>
      <p style={{ color: '#8A8A93', fontSize: '0.82rem', lineHeight: 1.55, margin: '0 0 16px' }}>
        A single-photo <strong style={{ color: '#D4D4D8' }}>2D screening</strong> (BlazePose, 33 landmarks) — no depth, so monocular parallax and camera tilt can affect angles. &ldquo;Stability&rdquo; shows how consistent each measurement was across the multi-frame capture burst, not a clinical-accuracy guarantee.
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
            const stColor = s == null ? '#A1A1AA' : s >= 0.8 ? '#22C55E' : s >= 0.6 ? '#F59E0B' : '#EF4444'
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                <span style={{ color: '#D4D4D8', fontSize: '0.85rem', flex: 1 }}>{f.label}</span>
                {f.uncertainty_deg != null && <span style={{ color: '#A1A1AA', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>±{f.uncertainty_deg.toFixed(1)}°</span>}
                {s != null && <span style={{ color: stColor, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{Math.round(s * 100)}% stable</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
