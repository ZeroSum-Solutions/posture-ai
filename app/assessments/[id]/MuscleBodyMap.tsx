'use client'
import Link from 'next/link'
import { resolveMarkerRegions, type MuscleLink } from './muscleMap'

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
export default function MuscleBodyMap({
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
  // Legacy-first per role; falls back to normalized links when a role's legacy
  // array is empty (see muscleMap.ts). In production legacy arrays are always
  // present, so this is identical to the prior behavior.
  const { frontTight, frontWeak, backTight, backWeak, hasAny } = resolveMarkerRegions({
    tightMuscles,
    weakMuscles,
    tightLinks,
    weakLinks,
  })

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
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="#EF444440" stroke="#EF4444" strokeWidth="1.2"
              />
            ))}
            {frontWeak.map((item, i) => (
              <ellipse
                key={'fw-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
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
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="#EF444440" stroke="#EF4444" strokeWidth="1.2"
              />
            ))}
            {backWeak.map((item, i) => (
              <ellipse
                key={'bw-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="#6366F140" stroke="#6366F1" strokeWidth="1.2"
              />
            ))}
          </svg>
        </div>
      )}

      {/* Named muscle lists */}
      <div style={{ flex: 1, minWidth: 100 }}>
        {(tightMuscles.length > 0 || tightLinks.length > 0) && (
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
        {(weakMuscles.length > 0 || weakLinks.length > 0) && (
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
