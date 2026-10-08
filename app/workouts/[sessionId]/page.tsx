import { notFound, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import type { RunItem } from '@/lib/workout/runState'
import AuthedPlayer from './player'
import { serverClinicalContentAccessForPractitioner } from '@/lib/clinical-content/database'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { isSessionSnapshotForOperation } from '@/lib/workout/operationSnapshot'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * In-clinic player entry. Loads the frozen program_snapshot via the practitioner's
 * own RLS-scoped read (a session belongs to auth.uid() or it 404s), fetches the
 * client's first name separately (it is deliberately NOT in the snapshot, so an
 * erased client leaves no residual PHI), and hydrates resume state from the run.
 */
export default async function WorkoutSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/sign-in?next=/workouts/${sessionId}`)
  const clinicalAccess = await serverClinicalContentAccessForPractitioner(user.id)
  if (!clinicalAccess.surfaces.workouts || !clinicalAccess.contentVersion) notFound()
  const operation = operationForPractitioner(user.id)

  const { data: session } = await supabase
    .from('workout_sessions')
    .select('id, assessment_id, client_id, program_snapshot')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) notFound()
  if (!isSessionSnapshotForOperation(session.program_snapshot, operation, {
    version: clinicalAccess.contentVersion,
    inventorySha256: clinicalAccess.inventorySha256,
  })) {
    return (
      <div className="app-screen app-screen-x" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-16)', paddingTop: 'calc(var(--sa-t) + 72px)' }}>
        <p className="t-micro" style={{ margin: 0 }}>Saved workout</p>
        <h1 className="t-display" style={{ margin: 0 }}>This plan needs a current copy.</h1>
        <p className="t-body" style={{ margin: 0 }}>
          Its saved catalog provenance does not match the current operation. The original remains in your library.
        </p>
        <div style={{ display: 'grid', gap: 'var(--s-8)', marginTop: 'var(--s-16)' }}>
          <Link className="a-primary a-primary--bar" href={`/workouts?assessment_id=${session.assessment_id}`}>
            Regenerate copy
          </Link>
          <Link className="a-quiet" href="/workouts" style={{ justifySelf: 'center' }}>
            Back to workouts
          </Link>
        </div>
      </div>
    )
  }

  const [{ data: client }, { data: run, error: runErr }] = await Promise.all([
    supabase.from('clients').select('first_name').eq('id', session.client_id).maybeSingle(),
    supabase
      .from('session_runs')
      .select('current_item_index, items, status, revision')
      .eq('workout_session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  // A failed run read silently drops resume state (player restarts from item 0);
  // surface it in logs rather than pretending there was no prior progress.
  if (runErr) console.error(`[workouts/${sessionId}] resume read failed:`, runErr.message)

  const resume =
    run && run.status !== 'completed'
      ? {
          index: (run.current_item_index as number) ?? 0,
          items: (run.items as RunItem[]) ?? [],
          revision: (run.revision as number) ?? 0,
        }
      : null

  return (
    <AuthedPlayer
      sessionId={sessionId}
      snapshot={session.program_snapshot as SessionSnapshot}
      clientFirstName={client?.first_name ?? null}
      resume={resume}
      backHref={`/assessments/${session.assessment_id}`}
    />
  )
}
