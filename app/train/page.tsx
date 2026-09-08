import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import StrengthBuilderEntry from '@/app/workouts/_strength/StrengthBuilderEntry'
import TrainingSessionPlayer from '@/app/workouts/_strength/TrainingSessionPlayer'
import TrainingEligibilityForm from './TrainingEligibilityForm'
import styles from '@/app/workouts/WorkoutsPage.module.css'

export const dynamic = 'force-dynamic'

type TrainSearchParams = Record<string, string | string[] | undefined>

function TrainingAccessUnavailable() {
  return (
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div><p className="t-kicker">Athlete workspace</p><h1 className="t-headline">Train</h1></div>
      </header>
      <main className={`app-screen-x app-stack ${styles.main}`}>
        <p role="alert" className={styles.error}>Training access is unavailable. Sign in again or ask your coach to verify access.</p>
      </main>
    </div>
  )
}

export default async function TrainPage({ searchParams }: { searchParams: Promise<TrainSearchParams> }) {
  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) {
    if (actor.code === 'unauthorized') redirect('/auth/sign-in?next=/train')
    if (actor.code === 'mfa_required') redirect('/auth/mfa?next=/train')
    return <TrainingAccessUnavailable />
  }
  if (actor.actorKind === 'practitioner') redirect('/workouts')
  if (!actor.subjectId) return <TrainingAccessUnavailable />

  const { training_session_id: trainingSessionId } = await searchParams
  const selectedSessionId = typeof trainingSessionId === 'string' ? trainingSessionId : null

  if (selectedSessionId) {
    return (
      <div className={`app-screen ${styles.screen}`}>
        <header className={styles.header}>
          <div><p className="t-kicker">Training program</p><h1 className="t-headline">Session</h1></div>
          <Link href="/train" className="a-secondary">Back to my training</Link>
        </header>
        <main className={`app-screen-x app-stack ${styles.main}`}>
          <TrainingSessionPlayer key={selectedSessionId} sessionId={selectedSessionId} />
        </main>
      </div>
    )
  }

  return (
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div><p className="t-kicker">Athlete workspace</p><h1 className="t-headline">My training</h1></div>
      </header>
      <main className={`app-screen-x app-stack ${styles.main}`}>
        <TrainingEligibilityForm />
        <StrengthBuilderEntry source={{
          kind: 'live_subject',
          subject: { id: actor.subjectId, name: 'Your training' },
        }} />
      </main>
    </div>
  )
}
