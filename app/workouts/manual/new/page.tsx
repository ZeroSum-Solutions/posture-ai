import Link from 'next/link'
import { redirect } from 'next/navigation'
import ManualRoutineSubjectWorkspace from '../ManualRoutineSubjectWorkspace'
import { MAX_MANUAL_ROUTINE_URL_EXERCISES } from '../ManualRoutine.types'
import { manualReferenceChoices } from '../manualReferenceChoices'
import { loadManualRoutinePageIdentity } from '../manualPageIdentity'
import styles from '../ManualRoutines.module.css'

export const dynamic = 'force-dynamic'

type Params = Record<string, string | string[] | undefined>

export default async function NewManualRoutinePage({ searchParams }: { searchParams: Promise<Params> }) {
  const identity = await loadManualRoutinePageIdentity()
  if (identity.kind === 'unavailable') {
    if (identity.code === 'unauthorized') redirect('/auth/sign-in?next=/workouts/manual/new')
    if (identity.code === 'mfa_required') redirect('/auth/mfa?next=/workouts/manual/new')
  }
  const raw = (await searchParams).exercise
  const requested = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).slice(0, MAX_MANUAL_ROUTINE_URL_EXERCISES)
  const allExercises = manualReferenceChoices()
  const byId = new Map(allExercises.map(exercise => [exercise.id, exercise]))
  const seen = new Set<string>()
  const selected = requested.flatMap(id => {
    if (seen.has(id)) return []
    seen.add(id)
    const exercise = byId.get(id)
    return exercise ? [exercise] : []
  })

  return <div className={`app-screen ${styles.screen}`}>
    <header className={styles.header}>
      <div><p className="t-overline">Manual routine</p><h1 className="t-title-1">Create routine</h1></div>
      <Link className="a-secondary" href="/exercises">Back to exercise library</Link>
    </header>
    <div className={`app-screen-x app-stack ${styles.main}`}>
      {identity.kind === 'unavailable'
        ? <p role="alert" className={styles.error}>Training access is unavailable. Sign in again or verify the athlete relationship.</p>
        : <ManualRoutineSubjectWorkspace identity={identity} mode="create" exercises={selected} availableExercises={allExercises} />}
    </div>
  </div>
}
