import Link from 'next/link'
import { redirect } from 'next/navigation'
import ManualRoutineSubjectWorkspace from './ManualRoutineSubjectWorkspace'
import { loadManualRoutinePageIdentity } from './manualPageIdentity'
import styles from './ManualRoutines.module.css'

export const dynamic = 'force-dynamic'

export default async function ManualRoutinesPage() {
  const identity = await loadManualRoutinePageIdentity()
  if (identity.kind === 'unavailable') {
    if (identity.code === 'unauthorized') redirect('/auth/sign-in?next=/workouts/manual')
    if (identity.code === 'mfa_required') redirect('/auth/mfa?next=/workouts/manual')
  }

  return <div className={`app-screen ${styles.screen}`}>
    <header className={styles.header}>
      <div><p className="t-kicker">Your own targets</p><h1 className="t-headline">Manual routines</h1></div>
      <div className={styles.actions}>
        <Link className="a-secondary" href={identity.kind === 'athlete' ? '/train' : '/workouts'}>{identity.kind === 'athlete' ? 'My training' : 'Workouts'}</Link>
        <Link className="a-primary" href="/exercises">Create from exercises</Link>
      </div>
    </header>
    <main className={`app-screen-x app-stack ${styles.main}`}>
      <p className="t-body">Build durable routines from attributed reference instructions. You choose every target; scans and automatic progression are not used.</p>
      {identity.kind === 'unavailable'
        ? <p role="alert" className={styles.error}>Training access is unavailable. Sign in again or verify the athlete relationship.</p>
        : <ManualRoutineSubjectWorkspace identity={identity} mode="list" />}
    </main>
  </div>
}
