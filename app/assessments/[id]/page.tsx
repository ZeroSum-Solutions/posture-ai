'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
  causes_text?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  tight_muscle_links?: MuscleLink[]
  weak_muscle_links?: MuscleLink[]
}

interface MuscleLink {
  slug: string
  name: string
}

interface Capture {
  id: string
  view: string
  signed_url: string | null
  source: string
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
  overall_percentile: number
  front_rank: number | null
  side_rank: number | null
  assessed_at: string
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

// ---- Muscle → Body-Map Coordinates ----
// viewBox: 0 0 80 180 for front and back
const MUSCLE_REGIONS: Record<string, { view: 'front' | 'back'; cx: number; cy: number; rx: number; ry: number }> = {
  'suboccipitals': { view: 'back', cx: 40, cy: 8, rx: 9, ry: 5 },
  'upper trapezius': { view: 'back', cx: 40, cy: 20, rx: 22, ry: 8 },
  'levator scapulae': { view: 'back', cx: 34, cy: 14, rx: 8, ry: 7 },
  'sternocleidomastoid': { view: 'front', cx: 36, cy: 15, rx: 6, ry: 7 },
  'deep cervical flexors': { view: 'front', cx: 40, cy: 14, rx: 10, ry: 5 },
  'lower trapezius': { view: 'back', cx: 40, cy: 54, rx: 16, ry: 7 },
  'middle trapezius': { view: 'back', cx: 40, cy: 40, rx: 18, ry: 7 },
  'pectoralis major': { view: 'front', cx: 40, cy: 36, rx: 20, ry: 11 },
  'pectoralis minor': { view: 'front', cx: 40, cy: 30, rx: 13, ry: 8 },
  'anterior deltoid': { view: 'front', cx: 22, cy: 28, rx: 7, ry: 8 },
  'rhomboids': { view: 'back', cx: 40, cy: 43, rx: 10, ry: 10 },
  'serratus anterior': { view: 'front', cx: 26, cy: 52, rx: 7, ry: 12 },
  'thoracic erector spinae': { view: 'back', cx: 40, cy: 48, rx: 5, ry: 18 },
  'latissimus dorsi': { view: 'back', cx: 40, cy: 62, rx: 22, ry: 14 },
  'deep thoracic flexors': { view: 'front', cx: 40, cy: 42, rx: 14, ry: 10 },
  'abdominals': { view: 'front', cx: 40, cy: 66, rx: 13, ry: 18 },
  'hip flexors': { view: 'front', cx: 40, cy: 93, rx: 16, ry: 7 },
  'lumbar erector spinae': { view: 'back', cx: 40, cy: 76, rx: 5, ry: 12 },
  'gastrocnemius': { view: 'back', cx: 40, cy: 153, rx: 10, ry: 15 },
  'gluteals': { view: 'back', cx: 40, cy: 93, rx: 20, ry: 11 },
  'hamstrings': { view: 'back', cx: 40, cy: 118, rx: 12, ry: 21 },
  'gluteus medius': { view: 'back', cx: 40, cy: 86, rx: 14, ry: 7 },
  'tensor fasciae latae': { view: 'front', cx: 20, cy: 97, rx: 7, ry: 10 },
  'quadratus lumborum': { view: 'back', cx: 40, cy: 75, rx: 14, ry: 7 },
  'quadriceps': { view: 'front', cx: 40, cy: 116, rx: 20, ry: 20 },
  'vastus medialis (vmo)': { view: 'front', cx: 40, cy: 140, rx: 13, ry: 7 },
  'adductors': { view: 'front', cx: 40, cy: 120, rx: 9, ry: 16 },
  'obliques': { view: 'front', cx: 40, cy: 66, rx: 18, ry: 13 },
  'one-side hip rotators': { view: 'back', cx: 40, cy: 91, rx: 14, ry: 10 },
  'it band': { view: 'front', cx: 20, cy: 116, rx: 5, ry: 20 },
  'popliteus': { view: 'back', cx: 40, cy: 136, rx: 8, ry: 6 },
}

function normalizeMuscle(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\([^)]*\)/g, '').trim()
}

function getMuscleRegion(name: string) {
  const key = normalizeMuscle(name)
  if (MUSCLE_REGIONS[key]) return MUSCLE_REGIONS[key]
  for (const [k, v] of Object.entries(MUSCLE_REGIONS)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return null
}

// Schematic body silhouette paths (front and back, viewBox 0 0 80 180)
function BodySilhouette({ view }: { view: 'front' | 'back' }) {
  const bodyColor = '#2A2A2E'
  const strokeColor = '#3F3F46'

  if (view === 'front') {
    return (
      <>
        {/* Head */}
        <circle cx="40" cy="10" r="9" fill={bodyColor} stroke={strokeColor} strokeWidth="1.2"/>
        {/* Neck */}
        <rect x="37" y="19" width="6" height="6" rx="1" fill={bodyColor} stroke={strokeColor} strokeWidth="1"/>
        {/* Torso */}
        <path d="M 20 25 L 60 25 L 64 80 L 16 80 Z" fill={bodyColor} stroke={strokeColor} strokeWidth="1.2"/>
        {/* Left arm */}
        <path d="M 20 25 L 10 55 L 8 80" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Right arm */}
        <path d="M 60 25 L 70 55 L 72 80" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Left thigh */}
        <path d="M 16 80 L 28 130" stroke={strokeColor} strokeWidth="4" fill="none" strokeLinecap="round"/>
        {/* Right thigh */}
        <path d="M 64 80 L 52 130" stroke={strokeColor} strokeWidth="4" fill="none" strokeLinecap="round"/>
        {/* Left shin */}
        <path d="M 28 130 L 26 165" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Right shin */}
        <path d="M 52 130 L 54 165" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
        {/* Left foot */}
        <path d="M 18 165 L 30 165" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round"/>
        {/* Right foot */}
        <path d="M 50 165 L 62 165" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round"/>
      </>
    )
  }

  return (
    <>
      {/* Head */}
      <circle cx="40" cy="10" r="9" fill={bodyColor} stroke={strokeColor} strokeWidth="1.2"/>
      {/* Neck */}
      <rect x="37" y="19" width="6" height="6" rx="1" fill={bodyColor} stroke={strokeColor} strokeWidth="1"/>
      {/* Torso */}
      <path d="M 20 25 L 60 25 L 64 80 L 16 80 Z" fill={bodyColor} stroke={strokeColor} strokeWidth="1.2"/>
      {/* Left arm */}
      <path d="M 20 25 L 10 55 L 8 80" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Right arm */}
      <path d="M 60 25 L 70 55 L 72 80" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Left thigh */}
      <path d="M 16 80 L 28 130" stroke={strokeColor} strokeWidth="4" fill="none" strokeLinecap="round"/>
      {/* Right thigh */}
      <path d="M 64 80 L 52 130" stroke={strokeColor} strokeWidth="4" fill="none" strokeLinecap="round"/>
      {/* Left shin */}
      <path d="M 28 130 L 26 165" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Right shin */}
      <path d="M 52 130 L 54 165" stroke={strokeColor} strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Left foot */}
      <path d="M 18 165 L 30 165" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round"/>
      {/* Right foot */}
      <path d="M 50 165 L 62 165" stroke={strokeColor} strokeWidth="2" fill="none" strokeLinecap="round"/>
    </>
  )
}

// Muscle Body-Map SVG
function MuscleBodyMap({
  tightMuscles,
  weakMuscles,
  tightLinks = [],
  weakLinks = [],
}: {
  tightMuscles: string[]
  weakMuscles: string[]
  tightLinks?: MuscleLink[]
  weakLinks?: MuscleLink[]
}) {
  // Collect highlighted regions
  const tightRegions = tightMuscles.map(m => ({ muscle: m, region: getMuscleRegion(m) })).filter(x => x.region)
  const weakRegions = weakMuscles.map(m => ({ muscle: m, region: getMuscleRegion(m) })).filter(x => x.region)

  // Split by view
  const frontTight = tightRegions.filter(r => r.region?.view === 'front')
  const frontWeak = weakRegions.filter(r => r.region?.view === 'front')
  const backTight = tightRegions.filter(r => r.region?.view === 'back')
  const backWeak = weakRegions.filter(r => r.region?.view === 'back')

  const hasAny = frontTight.length > 0 || frontWeak.length > 0 || backTight.length > 0 || backWeak.length > 0

  if (!hasAny) return null

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Front view */}
      {(frontTight.length > 0 || frontWeak.length > 0) && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Front</div>
          <svg viewBox="0 0 80 175" width="72" height="157" style={{ display: 'block', background: '#0A0A0B', borderRadius: 6 }}>
            <BodySilhouette view="front"/>
            {frontTight.map((item, i) => (
              <ellipse
                key={'ft-' + i}
                cx={item.region!.cx} cy={item.region!.cy}
                rx={item.region!.rx} ry={item.region!.ry}
                fill="#EF444440" stroke="#EF4444" strokeWidth="1.2"
              />
            ))}
            {frontWeak.map((item, i) => (
              <ellipse
                key={'fw-' + i}
                cx={item.region!.cx} cy={item.region!.cy}
                rx={item.region!.rx} ry={item.region!.ry}
                fill="#6366F140" stroke="#6366F1" strokeWidth="1.2"
              />
            ))}
          </svg>
        </div>
      )}

      {/* Back view */}
      {(backTight.length > 0 || backWeak.length > 0) && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Back</div>
          <svg viewBox="0 0 80 175" width="72" height="157" style={{ display: 'block', background: '#0A0A0B', borderRadius: 6 }}>
            <BodySilhouette view="back"/>
            {backTight.map((item, i) => (
              <ellipse
                key={'bt-' + i}
                cx={item.region!.cx} cy={item.region!.cy}
                rx={item.region!.rx} ry={item.region!.ry}
                fill="#EF444440" stroke="#EF4444" strokeWidth="1.2"
              />
            ))}
            {backWeak.map((item, i) => (
              <ellipse
                key={'bw-' + i}
                cx={item.region!.cx} cy={item.region!.cy}
                rx={item.region!.rx} ry={item.region!.ry}
                fill="#6366F140" stroke="#6366F1" strokeWidth="1.2"
              />
            ))}
          </svg>
        </div>
      )}

      {/* Named muscle lists */}
      <div style={{ flex: 1, minWidth: 100 }}>
        {tightMuscles.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }}/>
              Tight
            </div>
            {tightLinks.length > 0
              ? tightLinks.map((m) => (
                  <div key={m.slug} style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                    <Link href={`/muscles/${m.slug}`} data-testid={`muscle-chip-${m.slug}`}
                      style={{ color: '#EF4444', opacity: 0.95, textDecoration: 'underline', textDecorationColor: 'rgba(239,68,68,0.4)' }}>
                      • {m.name}
                    </Link>
                  </div>
                ))
              : tightMuscles.map((m, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: '#EF4444', opacity: 0.85, lineHeight: 1.6 }}>• {m}</div>
            ))}
          </div>
        )}
        {weakMuscles.length > 0 && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4F46E5', display: 'inline-block' }}/>
              Weak
            </div>
            {weakLinks.length > 0
              ? weakLinks.map((m) => (
                  <div key={m.slug} style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                    <Link href={`/muscles/${m.slug}`} data-testid={`muscle-chip-${m.slug}`}
                      style={{ color: '#818CF8', opacity: 0.95, textDecoration: 'underline', textDecorationColor: 'rgba(99,102,241,0.4)' }}>
                      • {m.name}
                    </Link>
                  </div>
                ))
              : weakMuscles.map((m, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: '#818CF8', opacity: 0.85, lineHeight: 1.6 }}>• {m}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
  findings, frontCapture, sideCapture, frontRank, sideRank,
}: {
  findings: Finding[]
  frontCapture: Capture | null
  sideCapture: Capture | null
  frontRank: number | null
  sideRank: number | null
}) {
  function ordinal(n: number): string {
    const v = n % 100
    if (v >= 11 && v <= 13) return `${n}th`
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
  }
  function rankLabel(rank: number | null): string {
    if (rank === null || rank === undefined) return 'Rank N/A — insufficient data'
    return `Rank ${ordinal(rank)} out of 100`
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
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#8A8A93', fontWeight: 500 }}>{rankLabel(frontRank)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#818CF8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Side View</div>
          <SideSkeleton findings={findings} captureUrl={sideCapture?.signed_url ?? null}/>
          <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#8A8A93', fontWeight: 500 }}>{rankLabel(sideRank)}</div>
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
      <p style={{ marginTop: 14, fontSize: '0.68rem', color: '#52525B', textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
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
        <span>Score: {score}</span>
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
            <div style={{ fontSize: '0.68rem', color: '#8A8A93', marginTop: 1 }}>{b.range}</div>
            <div style={{ fontSize: '0.65rem', color: '#52525B' }}>{b.desc}</div>
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
  const hasMuscles = (f.tight_muscles && f.tight_muscles.length > 0) || (f.weak_muscles && f.weak_muscles.length > 0)

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
        <span style={{ fontWeight: 600, color: isUnreliable ? '#71717A' : '#F5F5F5', fontSize: '0.9rem' }}>
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
            background: zoneColor + '22', color: zoneColor, textTransform: 'uppercase' }}>{f.zone}</span>
        </div>
      </div>

      {/* Deviation */}
      <div style={{ fontSize: '0.875rem', color: isUnreliable ? '#52525B' : '#D4D4D8', marginBottom: 10 }}>
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
            <span style={{ marginLeft: 'auto', color: '#52525B', transition: 'transform 0.2s', display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
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
  stretch: '#6366F1',
  strengthen: '#22C55E',
  mobility: '#F59E0B',
  activation: '#EC4899',
  informational: '#71717A',
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
          color: '#52525B', fontSize: '0.8rem', transition: 'transform 0.2s',
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
                <div style={{ fontSize: '0.7rem', color: '#8A8A93', textTransform: 'uppercase' }}>Sets</div>
              </div>
            )}
            {exercise.hold_seconds > 0 && (
              <div style={{ background: 'rgba(99,102,241,0.1)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#818CF8' }}>{exercise.hold_seconds}s</div>
                <div style={{ fontSize: '0.7rem', color: '#8A8A93', textTransform: 'uppercase' }}>Hold</div>
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
        Recommended Corrective Exercises
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
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [priorAssessments, setPriorAssessments] = useState<Array<{id: string; assessed_at: string; overall_grade: string}>>([])
  const [compareToId, setCompareToId] = useState<string>('')
  const [allExercises, setAllExercises] = useState<Exercise[]>([])

  useEffect(() => {
    params.then(p => setAssessmentId(p.id))
  }, [params])

  useEffect(() => {
    if (!assessmentId) return
    async function load() {
      try {
        const r = await fetch('/api/assessments/' + assessmentId)
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
        if (data.assessment?.clients?.id) {
          const clientId = data.assessment.clients.id
          const priorRes = await fetch('/api/clients/' + clientId + '/assessments?exclude=' + assessmentId)
          if (priorRes.ok) {
            const priorData = await priorRes.json()
            setPriorAssessments(priorData.assessments || [])
          }
        }
        // Fetch exercises
        const exRes = await fetch('/api/exercises')
        if (exRes.ok) {
          const exData = await exRes.json()
          setAllExercises(exData.exercises || [])
        }
      } catch {
        setError('Failed to load assessment.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [assessmentId, router])

  const exercises = useMemo(
    () => (allExercises.length > 0 && findings.length > 0 ? deriveExerciseRecommendations(allExercises, findings) : []),
    [allExercises, findings]
  )

  async function handleGeneratePdf() {
    if (!assessmentId) return
    setPdfLoading(true)
    setPdfError(null)
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, compared_to_assessment_id: compareToId || undefined }),
      })
      if (!r.ok) {
        const err = await r.json()
        setPdfError(err.error || 'PDF generation failed')
        return
      }
      const data = await r.json()
      setPdfUrl(data.signed_url)
    } catch {
      setPdfError('Failed to generate PDF.')
    } finally {
      setPdfLoading(false)
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
  const percentile = assessment.overall_percentile
  const color = gradeColor(grade)
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name
  const frontCapture = captures.find(c => c.view === 'front') ?? null
  const sideCapture = captures.find(c => c.view === 'side') ?? null

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
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: 4 }}>Top {percentile}%</div>
            <div style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: 16 }}>
              Score: {score}/100 — Grade <span style={{ color, fontWeight: 700 }}>{grade}</span>
            </div>
            <ScoreBar score={score} grade={grade} />
          </div>
        </div>
        <BandTable currentGrade={grade} />
      </div>

      <SkeletalDiagramSection
        findings={findings}
        frontCapture={frontCapture}
        sideCapture={sideCapture}
        frontRank={assessment.front_rank}
        sideRank={assessment.side_rank}
      />

      {findings.length > 0 && <FindingsSection findings={findings} />}

      <ExercisesSection exercises={exercises} />

      <div style={{
        background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: 10, padding: '12px 16px', fontSize: '0.78rem', color: '#8A8A93', lineHeight: 1.5, marginBottom: 24 }}>
        <strong style={{ color: '#EF4444' }}>SCREENING TOOL ONLY.</strong> These findings are for educational and informational purposes only. Always consult a qualified health professional for evaluation and clinical decisions.
      </div>

      {pdfUrl && (
        <div style={{ background: '#161618', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <p style={{ color: '#22C55E', fontSize: '0.875rem', marginBottom: 8 }}>PDF report generated successfully.</p>
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{
            padding: '10px 20px', borderRadius: 8, background: '#4F46E5',
            color: '#fff', fontWeight: 600, fontSize: '0.875rem', textDecoration: 'none', display: 'inline-block' }}>Download PDF</a>
        </div>
      )}
      {pdfError && <div style={{ color: '#EF4444', fontSize: '0.875rem', marginBottom: 16 }}>{pdfError}</div>}

      {priorAssessments.length > 0 && (
        <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <label style={{ fontSize: '0.8rem', color: '#A1A1AA', display: 'block', marginBottom: 8 }}>
            Compare PDF to prior assessment (optional):
          </label>
          <select value={compareToId} onChange={e => setCompareToId(e.target.value)}
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href={'/clients/' + assessment.clients.id} style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.06)',
          color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>Back to Client</Link>
        <button onClick={handleGeneratePdf} disabled={pdfLoading}
          style={{ padding: '12px 24px', borderRadius: 10,
            background: pdfLoading ? 'rgba(99,102,241,0.06)' : 'rgba(99,102,241,0.15)',
            color: pdfLoading ? '#6366F1aa' : '#6366F1',
            border: '1px solid rgba(99,102,241,0.3)',
            fontWeight: 600, fontSize: '0.9rem', cursor: pdfLoading ? 'wait' : 'pointer', minHeight: 44 }}>
          {pdfLoading ? 'Generating PDF...' : 'Generate PDF'}
        </button>
        <Link href="/assessments/new" style={{
          padding: '12px 24px', borderRadius: 10, background: 'rgba(255,255,255,0.04)',
          color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.08)',
          fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>New Assessment</Link>
      </div>
    </div>
  )
}
