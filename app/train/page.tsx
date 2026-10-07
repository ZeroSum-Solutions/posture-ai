import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import StrengthBuilderEntry from '@/app/workouts/_strength/StrengthBuilderEntry'
import TrainingSessionPlayer from '@/app/workouts/_strength/TrainingSessionPlayer'
import TrainingProgramWorkspace from '@/app/workouts/_strength/TrainingProgramWorkspace'
import TrainingEligibilityForm from './TrainingEligibilityForm'
import { Button, ErrorState, TopBar } from '@/components/ui'
import styles from '@/app/workouts/WorkoutsPage.module.css'

export const dynamic = 'force-dynamic'

type TrainSearchParams = Record<string, string | string[] | undefined>

function TrainingAccessUnavailable() {
  return (
    <div className={`app-screen ${styles.screen}`}>
      <TopBar title="Train" subtitle="Athlete workspace" />
      <div className={`app-screen-x app-stack ${styles.main}`}>
        <ErrorState
          variant="blocking"
          title="Training access is unavailable"
          body="Sign in again or ask your coach to verify access."
        />
      </div>
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

  const { training_session_id: trainingSessionId, training_program_id: trainingProgramId } = await searchParams
  if (Array.isArray(trainingSessionId) || Array.isArray(trainingProgramId)
    || (trainingSessionId !== undefined && trainingProgramId !== undefined)) redirect('/train')
  const selectedSessionId = typeof trainingSessionId === 'string' ? trainingSessionId : null
  const selectedProgramId = typeof trainingProgramId === 'string' ? trainingProgramId : null

  if (selectedProgramId) {
    return (
      <div className={`app-screen ${styles.screen}`}>
        <TopBar title="My program" subtitle="Training program" back={{ href: '/train', label: 'Back to my training' }} />
        <div className={`app-screen-x app-stack ${styles.main}`}>
          <TrainingProgramWorkspace assignmentId={selectedProgramId} sessionHrefBase="/train" backHref="/train" />
        </div>
      </div>
    )
  }

  if (selectedSessionId) {
    return (
      <div className={`app-screen ${styles.screen}`}>
        <TopBar title="Session" subtitle="Training program" back={{ href: '/train', label: 'Back to my training' }} />
        <div className={`app-screen-x app-stack ${styles.main}`}>
          <TrainingSessionPlayer key={selectedSessionId} sessionId={selectedSessionId} />
        </div>
      </div>
    )
  }

  return (
    <div className={`app-screen ${styles.screen}`}>
      <TopBar title="My training" subtitle="Athlete workspace" />
      <div className={`app-screen-x app-stack ${styles.main}`}>
        <nav aria-label="Workout tools" className={styles.actions}>
          <Button href="/workouts/manual" variant="secondary" size="sm">My routines</Button>
          <Button href="/exercises" variant="secondary" size="sm">Exercise library</Button>
          <Button href="/train/privacy" variant="secondary" size="sm">Training data</Button>
        </nav>
        <TrainingEligibilityForm />
        <StrengthBuilderEntry source={{
          kind: 'live_subject',
          subject: { id: actor.subjectId, name: 'Your training' },
        }} />
      </div>
    </div>
  )
}
