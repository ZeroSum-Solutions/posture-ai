import { notFound } from 'next/navigation'
import { Disclaimer } from '@/components/Disclaimer'
import { SeverityChip, TopBar } from '@/components/ui'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import {
  approvedClinicalExercises,
  approvedClinicalLinks,
  approvedClinicalMuscles,
  approvedExerciseMuscles,
} from '@/lib/clinical-content/catalog'
import { IMBALANCE_COPY } from '@/content/report/imbalance-copy'
import styles from '../Muscles.module.css'

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
      <TopBar
        title={muscle.name}
        subtitle={REGION_LABELS[muscle.region] ?? muscle.region}
        back={{ href: '/muscles', label: 'Back to Muscle guide' }}
        actions={access.mode === 'test_fixture' ? <SeverityChip band="monitor" size="sm" label="Pending review" /> : undefined}
      />
      <div className={`app-screen-x ${styles.body}`}>
        {/* What it does leads — the one answer a practitioner opens this page for. */}
        <section className={styles.section} aria-labelledby="muscle-function">
          <h2 id="muscle-function" className={styles.eyebrow}>What it does</h2>
          <p className={styles.lede}>{muscle.functionText}</p>
        </section>

        <section className={styles.section} aria-labelledby="muscle-anatomy">
          <h2 id="muscle-anatomy" className="t-headline">Anatomy</h2>
          <p className="t-body">{muscle.anatomySummary}</p>
        </section>

        {muscle.screeningNotes && (
          <section className={styles.section} aria-labelledby="muscle-screening">
            <h2 id="muscle-screening" className="t-headline">In posture screening</h2>
            <p className="t-body">{muscle.screeningNotes}</p>
          </section>
        )}

        {(tightLinks.length > 0 || weakLinks.length > 0) && (
          <section data-testid="related-findings" className={styles.section} aria-labelledby="muscle-findings">
            <h2 id="muscle-findings" className="t-headline">Related posture findings</h2>
            <ul className={styles.links}>
              {tightLinks.map((l, i) => (
                <li key={`t${i}`} className={styles.link}>
                  <p className={styles.linkHead}><span className={styles.roleMark} data-role="tight" aria-hidden="true" />Commonly tight in: {l.imbalance_definitions?.label}</p>
                  <p className="t-callout">{l.rationale_text}</p>
                </li>
              ))}
              {weakLinks.map((l, i) => (
                <li key={`w${i}`} className={styles.link}>
                  <p className={styles.linkHead}><span className={styles.roleMark} data-role="weak" aria-hidden="true" />Commonly underactive in: {l.imbalance_definitions?.label}</p>
                  <p className="t-callout">{l.rationale_text}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {stretches.length > 0 && (
          <section data-testid="stretch-exercises" className={styles.section} aria-labelledby="muscle-stretch">
            <h2 id="muscle-stretch" className="t-headline">Stretching</h2>
            <div className={styles.links}>
              {stretches.map((e, i) => (
                <ExerciseRow key={i} row={e} />
              ))}
            </div>
          </section>
        )}

        {strengthening.length > 0 && (
          <section data-testid="strengthen-exercises" className={styles.section} aria-labelledby="muscle-strengthen">
            <h2 id="muscle-strengthen" className="t-headline">Strengthening progressions</h2>
            <div className={styles.links}>
              {strengthening.map((e, i) => (
                <ExerciseRow key={i} row={e} showLevel />
              ))}
            </div>
          </section>
        )}

        <footer className={styles.footer}>
          <Disclaimer />
        </footer>
      </div>
    </div>
  )
}

function ExerciseRow({ row, showLevel = false }: { row: ExerciseMuscleRow; showLevel?: boolean }) {
  const ex = row.exercises!
  const level = row.progression_level
  return (
    <div className={styles.exRow}>
      <div className={styles.exHead}>
        <span className={styles.exName}>{ex.name}</span>
        <span className={styles.exMeta}>
          {showLevel && LEVEL_LABELS[level] && (
            <span className={styles.level}>
              <span className={styles.steps} aria-hidden="true">
                {[1, 2, 3].map((step) => <span key={step} data-on={step <= level ? 'true' : undefined} />)}
              </span>
              {LEVEL_LABELS[level]}
            </span>
          )}
          {(ex.sets || ex.hold_seconds) && (
            <span className={styles.exDose}>
              {ex.sets ? `${ex.sets} sets` : ''}{ex.sets && ex.hold_seconds ? ' · ' : ''}{ex.hold_seconds ? `${ex.hold_seconds}s` : ''}
            </span>
          )}
        </span>
      </div>
      {ex.instructions && (
        <p className="t-callout">
          {ex.instructions}
        </p>
      )}
    </div>
  )
}
