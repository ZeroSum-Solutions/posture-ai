import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import TrainingSubjectErasure from './TrainingSubjectErasure'
import styles from '@/app/workouts/WorkoutsPage.module.css'

export const dynamic = 'force-dynamic'

export default async function TrainPrivacyPage() {
  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) {
    if (actor.code === 'unauthorized') redirect('/auth/sign-in?next=/train/privacy')
    if (actor.code === 'mfa_required') redirect('/auth/mfa?next=/train/privacy')
    redirect('/train')
  }
  if (actor.actorKind === 'practitioner') redirect('/workouts')
  if (!actor.subjectId) redirect('/train')

  return <div className={`app-screen ${styles.screen}`}>
    <header className={styles.header}>
      <div><p className="t-kicker">Athlete workspace</p><h1 className="t-headline">Training data</h1></div>
      <Link href="/train" className="a-secondary">Back to my training</Link>
    </header>
    <main className={`app-screen-x app-stack ${styles.main}`}>
      <TrainingSubjectErasure userId={actor.userId} subjectId={actor.subjectId} />
    </main>
  </div>
}
