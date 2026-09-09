import { notFound, redirect } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerAdmission } from '@/lib/auth/requirePractitioner'
import { serverClinicalContentAccessForPractitioner } from '@/lib/clinical-content/database'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { isSessionSnapshotForOperation } from '@/lib/workout/operationSnapshot'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import { DEFAULT_WORKOUT_PREFERENCES, workoutPreferencesSchema } from '@/lib/workout/personalize'
import WorkoutLibrary from './WorkoutLibrary'
import TrainingProgramWorkspace from './_strength/TrainingProgramWorkspace'
import styles from './WorkoutsPage.module.css'
import { type WorkoutBuilderSeed, type WorkoutLibraryItem, workoutLibraryKey } from './WorkoutLibrary.model'
import { projectStrengthClients, type StrengthClientRow } from './strengthClientProjection'

export const dynamic = 'force-dynamic'

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value }

function normalizeSnapshot(value: unknown): SessionSnapshot {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<SessionSnapshot>
    if (
      (candidate.capability === 'regression' || candidate.capability === 'standard' || candidate.capability === 'progression')
      && Array.isArray(candidate.items)
      && Array.isArray(candidate.priorities)
      && typeof candidate.estimatedDurationSec === 'number'
    ) return value as SessionSnapshot
  }
  return {
    version: 1,
    week: 1,
    capability: 'standard',
    priorities: [],
    items: [],
    estimatedDurationSec: 0,
    disclaimer: 'Saved workout provenance is unavailable.',
  }
}

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<{ assessment_id?: string; training_session_id?: string; training_program_id?: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in?next=/workouts')
  const admission = await practitionerAdmission(supabase, user.id)
  if (admission.response) notFound()

  const access = await serverClinicalContentAccessForPractitioner(user.id)
  if (!access.surfaces.workouts || !access.contentVersion) notFound()
  const { assessment_id: assessmentId, training_session_id: trainingSessionId, training_program_id: trainingProgramId } = await searchParams
  if (trainingProgramId && (trainingSessionId || assessmentId)) notFound()
  if (trainingProgramId) return (
    <div className={`app-screen ${styles.screen}`}>
      <main className={`app-screen-x app-stack ${styles.main}`}>
        <TrainingProgramWorkspace assignmentId={trainingProgramId} sessionHrefBase="/workouts" backHref="/workouts" />
      </main>
    </div>
  )
  const operation = operationForPractitioner(user.id)
  const service = createSupabaseServiceClient()

  const [sessionsResult, assessmentResult, clientsResult, simulationClientsResult] = await Promise.all([
    service
      .from('workout_sessions')
      .select('id, assessment_id, client_id, name, preferences, generation_source, program_snapshot, created_at, clients!inner(first_name, last_name, deleted_at), session_runs(status, items, completed_at)')
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    assessmentId
      ? service
          .from('assessments')
          .select('id, client_id, capability, practitioner_approved, clients!inner(first_name, last_name, deleted_at)')
          .eq('id', assessmentId)
          .eq('practitioner_id', user.id)
          .eq('status', 'complete')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service
      .from('clients')
      .select('id, first_name, last_name, archived_at')
      .eq('practitioner_id', user.id)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('first_name', { ascending: true })
      .limit(100),
    supabase.rpc('read_my_training_simulation_client_ids'),
  ])

  if (sessionsResult.error) console.error(`[workouts/${user.id}] library read failed:`, sessionsResult.error.message)
  if (assessmentResult.error) console.error(`[workouts/${user.id}] assessment seed read failed:`, assessmentResult.error.message)
  if (clientsResult.error) console.error(`[workouts/${user.id}] strength client list read failed:`, clientsResult.error.message)
  const simulationClientIds: unknown = simulationClientsResult.data
  const simulationClassificationComplete = !simulationClientsResult.error
    && Array.isArray(simulationClientIds)
    && simulationClientIds.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
  if (!simulationClassificationComplete) console.error('[workouts] strength client simulation classification failed')

  const library = ((sessionsResult.data ?? []) as unknown as Array<Record<string, unknown>>).flatMap((row): WorkoutLibraryItem[] => {
    const client = one(row.clients as { first_name: string; last_name: string; deleted_at: string | null } | Array<{ first_name: string; last_name: string; deleted_at: string | null }> | null)
    if (!client || client.deleted_at) return []
    const snapshot = normalizeSnapshot(row.program_snapshot)
    const parsedPreferences = workoutPreferencesSchema.safeParse(row.preferences)
    const preferences = parsedPreferences.success ? parsedPreferences.data : {
      ...DEFAULT_WORKOUT_PREFERENCES,
      capability: snapshot.capability,
    }
    const runs = Array.isArray(row.session_runs) ? row.session_runs as Array<Record<string, unknown>> : []
    const run = runs[0] ?? null
    const runItems = Array.isArray(run?.items) ? run.items as Array<{ completed?: boolean }> : []
    return [{
      id: row.id as string,
      assessmentId: row.assessment_id as string,
      clientId: row.client_id as string,
      clientName: `${client.first_name} ${client.last_name}`.trim(),
      name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Guided corrective session',
      source: row.generation_source === 'ai' ? 'ai' : 'scan',
      preferences,
      snapshot,
      createdAt: row.created_at as string,
      playable: isSessionSnapshotForOperation(snapshot, operation, {
        version: access.contentVersion!,
        inventorySha256: access.inventorySha256,
      }),
      run: run ? {
        status: String(run.status ?? 'ready'),
        completedItems: runItems.filter((item) => item.completed).length,
      } : null,
    }]
  })

  const rawAssessment = assessmentResult.data as unknown as {
    id: string; client_id: string; capability: string | null; practitioner_approved: boolean; clients: { first_name: string; last_name: string; deleted_at: string | null } | Array<{ first_name: string; last_name: string; deleted_at: string | null }> | null
  } | null
  const assessmentClient = rawAssessment ? one(rawAssessment.clients) : null
  const seed: WorkoutBuilderSeed | null = rawAssessment && assessmentClient && !assessmentClient.deleted_at ? {
    assessmentId: rawAssessment.id,
    clientId: rawAssessment.client_id,
    clientName: `${assessmentClient.first_name} ${assessmentClient.last_name}`.trim(),
    capability: rawAssessment.capability === 'regression' || rawAssessment.capability === 'progression' ? rawAssessment.capability : 'standard',
    approved: rawAssessment.practitioner_approved === true,
  } : null
  const strengthClients = projectStrengthClients(
    (clientsResult.data ?? []) as StrengthClientRow[],
    simulationClassificationComplete ? simulationClientIds as string[] : [],
    !clientsResult.error && simulationClassificationComplete,
  )

  return (
    <WorkoutLibrary
      key={workoutLibraryKey(library, seed)}
      initialLibrary={library}
      seed={seed}
      strengthClients={strengthClients}
      trainingSessionId={trainingSessionId}
      loadError={sessionsResult.error ? 'Workout library could not be loaded. Refresh to try again.' : null}
    />
  )
}
