import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Disclaimer } from '@/components/Disclaimer'
import Icon from '@/components/array/Icon'
import { Chip } from '@/components/array/Chip'
import { Surface } from '@/components/array/Surface'
import { tone, type SeverityBand } from '@/components/array/severity'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
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
/** Progression reads as the band that carries the most demand; regression the
 * least — the same ramp the severity bands already express elsewhere. */
const LEVEL_BANDS: Record<number, SeverityBand> = { 1: 'maintain', 2: 'info', 3: 'review' }

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
  const access = await currentPractitionerClinicalContentAccess()
  if (!access.surfaces.knowledgeLinks || !access.approvedMuscleSlugs.includes(slug)) notFound()
  const muscle = approvedClinicalMuscles(access).find((candidate) => candidate.slug === slug)
  if (!muscle) notFound()

  // Report copy is its own reviewed item kind: only render the plain-language
  // label when this release approved it, otherwise fall back to the raw key.
  const approvedCopy = new Set(access.approvedReportCopyIds)
  const typedLinks: LinkRow[] = approvedClinicalLinks(access)
    .filter((entry) => entry.muscle.slug === slug)
    .map(({ link }) => ({
      role: link.role,
      rationale_text: link.rationale,
      imbalance_definitions: {
        key: link.imbalanceKey,
        label: approvedCopy.has(`report_copy:${link.imbalanceKey}`)
          ? IMBALANCE_COPY[link.imbalanceKey]?.plainLabel ?? link.imbalanceKey
          : link.imbalanceKey,
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

  return (
    <div className="app-screen">
      <div className="app-screen-x app-stack">
        <Link href="/muscles" className="a-quiet" style={{ paddingLeft: 4 }}>
          <Icon name="alt-arrow-left-linear" size={16} />
          Muscle Guide
        </Link>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="t-headline">{muscle.name}</h1>
            {access.mode === 'test_fixture' && <Chip band="monitor" size="sm">Pending review</Chip>}
          </div>
          <p className="t-quiet" style={{ marginTop: 4 }}>{REGION_LABELS[muscle.region] ?? muscle.region}</p>
        </div>

        <Surface tier="tile">
          <h2 className="t-title" style={{ marginBottom: 8 }}>Anatomy</h2>
          <p className="t-body">{muscle.anatomySummary}</p>
        </Surface>

        <Surface tier="tile">
          <h2 className="t-title" style={{ marginBottom: 8 }}>What it does</h2>
          <p className="t-body">{muscle.functionText}</p>
        </Surface>

        {muscle.screeningNotes && (
          <Surface tier="tile">
            <h2 className="t-title" style={{ marginBottom: 8 }}>In posture screening</h2>
            <p className="t-body">{muscle.screeningNotes}</p>
          </Surface>
        )}

        {(tightLinks.length > 0 || weakLinks.length > 0) && (
          <div data-testid="related-findings">
            <Surface tier="tile">
              <h2 className="t-title" style={{ marginBottom: 12 }}>Related posture findings</h2>
              {tightLinks.map((l, i) => (
                <div key={`t${i}`} style={{ marginBottom: 12 }}>
                  <p className="t-body" style={{ fontWeight: 500, color: tone('review'), marginBottom: 4 }}>
                    Commonly tight in: {l.imbalance_definitions?.label}
                  </p>
                  <p className="t-body">{l.rationale_text}</p>
                </div>
              ))}
              {weakLinks.map((l, i) => (
                <div key={`w${i}`} style={{ marginBottom: 12 }}>
                  <p className="t-body" style={{ fontWeight: 500, color: tone('info'), marginBottom: 4 }}>
                    Commonly underactive in: {l.imbalance_definitions?.label}
                  </p>
                  <p className="t-body">{l.rationale_text}</p>
                </div>
              ))}
            </Surface>
          </div>
        )}

        {stretches.length > 0 && (
          <div data-testid="stretch-exercises">
            <Surface tier="tile">
              <h2 className="t-title" style={{ marginBottom: 4 }}>Stretching</h2>
              {stretches.map((e, i) => (
                <ExerciseRow key={i} row={e} />
              ))}
            </Surface>
          </div>
        )}

        {strengthening.length > 0 && (
          <div data-testid="strengthen-exercises">
            <Surface tier="tile">
              <h2 className="t-title" style={{ marginBottom: 4 }}>Strengthening progressions</h2>
              {strengthening.map((e, i) => (
                <ExerciseRow key={i} row={e} showLevel />
              ))}
            </Surface>
          </div>
        )}

        <Disclaimer />
      </div>
    </div>
  )
}

function ExerciseRow({ row, showLevel = false }: { row: ExerciseMuscleRow; showLevel?: boolean }) {
  const ex = row.exercises!
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--hairline-soft)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="t-title">{ex.name}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {showLevel && (
            <Chip band={LEVEL_BANDS[row.progression_level] ?? 'neutral'} size="sm">
              {LEVEL_LABELS[row.progression_level]}
            </Chip>
          )}
          {(ex.sets || ex.hold_seconds) && (
            <span className="t-quiet n">
              {ex.sets ? `${ex.sets} sets` : ''}{ex.sets && ex.hold_seconds ? ' · ' : ''}{ex.hold_seconds ? `${ex.hold_seconds}s` : ''}
            </span>
          )}
        </span>
      </div>
      {ex.instructions && (
        <p className="t-body" style={{ marginTop: 6 }}>
          {ex.instructions}
        </p>
      )}
    </div>
  )
}
