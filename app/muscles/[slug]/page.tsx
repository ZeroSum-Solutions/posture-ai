import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Disclaimer } from '@/components/Disclaimer'
import { serverClinicalContentAccess } from '@/lib/clinical-content/database'
import {
  approvedClinicalExercises,
  approvedClinicalLinks,
  approvedClinicalMuscles,
  approvedExerciseMuscles,
} from '@/lib/clinical-content/catalog'
import { IMBALANCE_COPY } from '@/content/report/imbalance-copy'

export const dynamic = 'force-dynamic'

const REGION_LABELS: Record<string, string> = {
  head_neck: 'Head & Neck',
  shoulder_girdle: 'Shoulder Girdle',
  trunk: 'Trunk',
  hip_pelvis: 'Hip & Pelvis',
  knee_leg: 'Knee & Lower Leg',
}

const LEVEL_LABELS: Record<number, string> = { 1: 'Regression', 2: 'Standard', 3: 'Progression' }

interface LinkRow {
  role: 'tight' | 'weak'
  rationale_text: string
  imbalance_definitions: { key: string; label: string } | null
}

interface ExerciseMuscleRow {
  role: 'stretch' | 'strengthen'
  progression_level: number
  exercises: {
    id: string
    slug: string
    name: string
    category: string
    instructions: string | null
    sets: number | null
    hold_seconds: number | null
  } | null
}

export default async function MusclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await serverClinicalContentAccess()
  if (!access.surfaces.knowledgeLinks || !access.approvedMuscleSlugs.includes(slug)) notFound()
  const muscle = approvedClinicalMuscles(access).find((candidate) => candidate.slug === slug)
  if (!muscle) notFound()

  const typedLinks: LinkRow[] = approvedClinicalLinks(access)
    .filter((entry) => entry.muscle.slug === slug)
    .map(({ link }) => ({
      role: link.role,
      rationale_text: link.rationale,
      imbalance_definitions: {
        key: link.imbalanceKey,
        label: IMBALANCE_COPY[link.imbalanceKey]?.plainLabel ?? link.imbalanceKey,
      },
    }))
  const typedExercises: ExerciseMuscleRow[] = access.surfaces.recommendations
    ? approvedClinicalExercises(access).flatMap((exercise) =>
        approvedExerciseMuscles(access, exercise)
          .filter((link) => link.muscleSlug === slug)
          .map((link) => ({
            role: link.role,
            progression_level: link.progressionLevel,
            exercises: {
              id: exercise.slug,
              slug: exercise.slug,
              name: exercise.name,
              category: exercise.category,
              instructions: exercise.instructions,
              sets: exercise.sets,
              hold_seconds: exercise.holdSeconds,
            },
          })),
      )
    : []
  const tightLinks = typedLinks.filter(l => l.role === 'tight')
  const weakLinks = typedLinks.filter(l => l.role === 'weak')
  const stretches = typedExercises.filter(e => e.role === 'stretch' && e.exercises)
  const strengthening = typedExercises
    .filter(e => e.role === 'strengthen' && e.exercises)
    .sort((a, b) => a.progression_level - b.progression_level)

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '18px',
    marginBottom: '16px',
  }
  const h2: React.CSSProperties = { fontSize: '1rem', fontWeight: 600, color: 'var(--brand)', margin: '0 0 10px' }
  const body: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '760px', margin: '0 auto' }}>
      <Link href="/muscles" style={{ color: 'var(--brand)', fontSize: '0.85rem', textDecoration: 'none' }}>
        ← Muscle Guide
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '12px 0 4px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{muscle.name}</h1>
        {access.mode === 'test_fixture' && (
          <span style={{
            fontSize: '0.65rem', padding: '3px 9px', borderRadius: '4px',
            background: 'rgba(255,137,24,0.15)', color: 'var(--warning)', textTransform: 'uppercase',
          }}>
            Pending review
          </span>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 20px' }}>
        {REGION_LABELS[muscle.region] ?? muscle.region}
      </p>

      <div style={card}>
        <h2 style={h2}>Anatomy</h2>
        <p style={body}>{muscle.anatomySummary}</p>
      </div>

      <div style={card}>
        <h2 style={h2}>What it does</h2>
        <p style={body}>{muscle.functionText}</p>
      </div>

      {muscle.screeningNotes && (
        <div style={card}>
          <h2 style={h2}>In posture screening</h2>
          <p style={body}>{muscle.screeningNotes}</p>
        </div>
      )}

      {(tightLinks.length > 0 || weakLinks.length > 0) && (
        <div style={card} data-testid="related-findings">
          <h2 style={h2}>Related posture findings</h2>
          {tightLinks.map((l, i) => (
            <div key={`t${i}`} style={{ marginBottom: '12px' }}>
              <p style={{ ...body, fontWeight: 600, color: 'var(--danger)', marginBottom: '4px' }}>
                Commonly tight in: {l.imbalance_definitions?.label}
              </p>
              <p style={{ ...body, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{l.rationale_text}</p>
            </div>
          ))}
          {weakLinks.map((l, i) => (
            <div key={`w${i}`} style={{ marginBottom: '12px' }}>
              <p style={{ ...body, fontWeight: 600, color: 'var(--brand)', marginBottom: '4px' }}>
                Commonly underactive in: {l.imbalance_definitions?.label}
              </p>
              <p style={{ ...body, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{l.rationale_text}</p>
            </div>
          ))}
        </div>
      )}

      {stretches.length > 0 && (
        <div style={card} data-testid="stretch-exercises">
          <h2 style={h2}>Stretching</h2>
          {stretches.map((e, i) => (
            <ExerciseRow key={i} row={e} />
          ))}
        </div>
      )}

      {strengthening.length > 0 && (
        <div style={card} data-testid="strengthen-exercises">
          <h2 style={h2}>Strengthening progressions</h2>
          {strengthening.map((e, i) => (
            <ExerciseRow key={i} row={e} showLevel />
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  )
}

function ExerciseRow({ row, showLevel = false }: { row: ExerciseMuscleRow; showLevel?: boolean }) {
  const ex = row.exercises!
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{ex.name}</span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {showLevel && (
            <span style={{
              fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase',
              background: row.progression_level === 3 ? 'rgba(239,68,68,0.15)' : row.progression_level === 1 ? 'rgba(16,185,129,0.15)' : 'rgba(0,152,243,0.15)',
              color: row.progression_level === 3 ? 'var(--danger)' : row.progression_level === 1 ? 'var(--maintain)' : 'var(--brand)',
            }}>
              {LEVEL_LABELS[row.progression_level]}
            </span>
          )}
          {(ex.sets || ex.hold_seconds) && (
            <span style={{ fontSize: '0.75rem', color: 'var(--brand)' }}>
              {ex.sets ? `${ex.sets} sets` : ''}{ex.sets && ex.hold_seconds ? ' · ' : ''}{ex.hold_seconds ? `${ex.hold_seconds}s` : ''}
            </span>
          )}
        </span>
      </div>
      {ex.instructions && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '6px 0 0' }}>
          {ex.instructions}
        </p>
      )}
    </div>
  )
}
