import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import ManualRoutineDetail from '../ManualRoutineDetail'
import { manualReferenceChoices } from '../manualReferenceChoices'
import { loadManualRoutinePageIdentity } from '../manualPageIdentity'
import styles from '../ManualRoutines.module.css'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function ManualRoutinePage({ params }: { params: Promise<{ routineId: string }> }) {
  const { routineId } = await params
  if (!UUID.test(routineId)) notFound()
  const identity = await loadManualRoutinePageIdentity()
  if (identity.kind === 'unavailable') {
    if (identity.code === 'unauthorized') redirect(`/auth/sign-in?next=/workouts/manual/${encodeURIComponent(routineId)}`)
    if (identity.code === 'mfa_required') redirect(`/auth/mfa?next=/workouts/manual/${encodeURIComponent(routineId)}`)
  }

  return <div className={`app-screen ${styles.screen}`}>
    <header className={styles.header}>
      <div><p className="t-overline">Saved manual routine</p><h1 className="t-title-1">Routine</h1></div>
      <Link className="a-secondary" href="/workouts/manual">All routines</Link>
    </header>
    <div className={`app-screen-x app-stack ${styles.main}`}>
      {identity.kind === 'unavailable'
        ? <p role="alert" className={styles.error}>Training access is unavailable. Sign in again or verify the athlete relationship.</p>
        : <ManualRoutineDetail routineId={routineId} availableExercises={manualReferenceChoices()} />}
    </div>
  </div>
}
