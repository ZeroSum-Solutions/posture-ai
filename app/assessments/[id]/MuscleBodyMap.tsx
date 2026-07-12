'use client'
import Link from 'next/link'
import { resolveMarkerRegions, type MuscleLink } from './muscleMap'

// Schematic body silhouette paths (front and back, viewBox 0 0 80 180)
function BodySilhouette({ view }: { view: 'front' | 'back' }) {
  const bodyColor = '#2A2A2E'
  const strokeColor = 'var(--border-strong)'

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
  // Links-first: graded knowledge-base links are the source of truth; legacy
  // name arrays are the fallback when a role has no links. Low-confidence links
  // are routed to the possible-involvement tier (dashed gray) and not drawn as
  // tight/weak markers.
  const { frontTight, frontWeak, backTight, backWeak, frontPossible, backPossible, hasAny } = resolveMarkerRegions({
    tightMuscles,
    weakMuscles,
    tightLinks,
    weakLinks,
  })

  const isLowLink = (m: MuscleLink) => m.confidence === 'low'
  const tightShown = tightLinks.filter((m) => !isLowLink(m))
  const weakShown = weakLinks.filter((m) => !isLowLink(m))
  const possibleLinks = [...tightLinks.filter(isLowLink), ...weakLinks.filter(isLowLink)]

  const hasTightChips = tightMuscles.length > 0 || tightShown.length > 0
  const hasWeakChips = weakMuscles.length > 0 || weakShown.length > 0

  // Render whenever there is anything to show — a marker OR a chip. A link with
  // no coordinate (e.g. rectus-femoris) shows as a chip with no marker rather
  // than an empty accordion, keeping this body consistent with hasAnyMuscle()
  // (the accordion gate). In production every legacy name has a coordinate, so
  // markers and chips always co-render exactly as before.
  const hasPossible = frontPossible.length > 0 || backPossible.length > 0
  if (!hasAny && !hasTightChips && !hasWeakChips && possibleLinks.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Front view */}
      {(frontTight.length > 0 || frontWeak.length > 0 || frontPossible.length > 0) && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Front</div>
          <svg viewBox="0 0 80 175" width="72" height="157" style={{ display: 'block', background: 'var(--background)', borderRadius: 6 }}>
            <BodySilhouette view="front"/>
            {frontTight.map((item, i) => (
              <ellipse
                key={'ft-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="var(--danger)" fillOpacity="0.25" stroke="var(--danger)" strokeWidth="1.2"
              />
            ))}
            {frontWeak.map((item, i) => (
              <ellipse
                key={'fw-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="var(--brand)" fillOpacity="0.25" stroke="var(--brand)" strokeWidth="1.2"
              />
            ))}
            {frontPossible.map((item, i) => (
              <ellipse key={`fp${i}`} cx={item.region.cx} cy={item.region.cy} rx={item.region.rx} ry={item.region.ry}
                fill="var(--text-muted)" fillOpacity="0.13" stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="3,3" />
            ))}
          </svg>
        </div>
      )}

      {/* Back view */}
      {(backTight.length > 0 || backWeak.length > 0 || backPossible.length > 0) && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Back</div>
          <svg viewBox="0 0 80 175" width="72" height="157" style={{ display: 'block', background: 'var(--background)', borderRadius: 6 }}>
            <BodySilhouette view="back"/>
            {backTight.map((item, i) => (
              <ellipse
                key={'bt-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="var(--danger)" fillOpacity="0.25" stroke="var(--danger)" strokeWidth="1.2"
              />
            ))}
            {backWeak.map((item, i) => (
              <ellipse
                key={'bw-' + i}
                cx={item.region.cx} cy={item.region.cy}
                rx={item.region.rx} ry={item.region.ry}
                fill="var(--brand)" fillOpacity="0.25" stroke="var(--brand)" strokeWidth="1.2"
              />
            ))}
            {backPossible.map((item, i) => (
              <ellipse key={`bp${i}`} cx={item.region.cx} cy={item.region.cy} rx={item.region.rx} ry={item.region.ry}
                fill="var(--text-muted)" fillOpacity="0.13" stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="3,3" />
            ))}
          </svg>
        </div>
      )}

      {/* Legend */}
      {hasPossible && (
        <div style={{ width: '100%', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="16" height="10">
              <ellipse cx="8" cy="5" rx="7" ry="4" fill="var(--text-muted)" fillOpacity="0.13" stroke="var(--text-secondary)" strokeWidth="1" strokeDasharray="3,3"/>
            </svg>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Possible involvement</span>
          </div>
        </div>
      )}

      {/* Named muscle lists */}
      <div style={{ flex: 1, minWidth: 100 }}>
        {(tightMuscles.length > 0 || tightShown.length > 0) && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }}/>
              Tight
            </div>
            {tightShown.length > 0
              ? tightShown.map((m) => (
                  <div key={m.slug} style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                    <Link href={`/muscles/${m.slug}`} data-testid={`muscle-chip-${m.slug}`}
                      style={{ color: 'var(--danger)', opacity: 0.95, textDecoration: 'underline', textDecorationColor: 'rgba(239,68,68,0.4)' }}>
                      • {m.name}
                    </Link>
                  </div>
                ))
              : tightMuscles.map((m, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: 'var(--danger)', opacity: 0.85, lineHeight: 1.6 }}>• {m}</div>
            ))}
          </div>
        )}
        {(weakMuscles.length > 0 || weakShown.length > 0) && (
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', display: 'inline-block' }}/>
              Weak
            </div>
            {weakShown.length > 0
              ? weakShown.map((m) => (
                  <div key={m.slug} style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                    <Link href={`/muscles/${m.slug}`} data-testid={`muscle-chip-${m.slug}`}
                      style={{ color: 'var(--brand)', opacity: 0.95, textDecoration: 'underline', textDecorationColor: 'rgba(0,152,243,0.4)' }}>
                      • {m.name}
                    </Link>
                  </div>
                ))
              : weakMuscles.map((m, i) => (
              <div key={i} style={{ fontSize: '0.72rem', color: 'var(--brand)', opacity: 0.85, lineHeight: 1.6 }}>• {m}</div>
            ))}
          </div>
        )}
        {possibleLinks.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-secondary)', display: 'inline-block' }}/>
              Possible
            </div>
            {possibleLinks.map((m) => (
              <div key={m.slug} style={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                <Link href={`/muscles/${m.slug}`} data-testid={`muscle-chip-${m.slug}`}
                  style={{ color: 'var(--text-secondary)', opacity: 0.9, textDecoration: 'underline', textDecorationColor: 'rgba(161,161,170,0.4)' }}>
                  • {m.name}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
