import 'server-only'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import { projectStrengthClients, type StrengthClientRow } from '../strengthClientProjection'
import type { ManualRoutinePageIdentity } from './ManualRoutine.types'

export async function loadManualRoutinePageIdentity(): Promise<ManualRoutinePageIdentity> {
  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) return { kind: 'unavailable', code: actor.code }
  if (actor.actorKind === 'athlete') {
    return actor.subjectId
      ? { kind: 'athlete', subjectId: actor.subjectId, name: 'Your routines' }
      : { kind: 'unavailable', code: 'training_actor_required' }
  }

  const service = createSupabaseServiceClient()
  const [clientsResult, simulationClientsResult] = await Promise.all([
    service.from('clients')
      .select('id, first_name, last_name, archived_at')
      .eq('practitioner_id', actor.userId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('first_name', { ascending: true })
      .limit(100),
    supabase.rpc('read_my_training_simulation_client_ids'),
  ])
  const rawIds: unknown = simulationClientsResult.data
  const classificationComplete = !clientsResult.error && !simulationClientsResult.error
    && Array.isArray(rawIds)
    && rawIds.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
  if (!classificationComplete) console.error('[manual-routines] client classification unavailable')
  return {
    kind: 'practitioner',
    clients: projectStrengthClients(
      (clientsResult.data ?? []) as StrengthClientRow[],
      classificationComplete ? rawIds as string[] : [],
      classificationComplete,
    ),
  }
}
