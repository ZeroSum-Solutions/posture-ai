import { TrainingStableIdV1Schema } from '../contracts/program'
import {
  adaptStrengthSessionEvidence,
  type StrengthSessionEvidenceResultV1,
} from '../progression/sessionEvidence'

interface TrainingProgressionReadClient {
  rpc(
    name: 'read_training_strength_evidence_projection',
    args: { p_session_id: string; p_exercise_instance_id: string },
  ): Promise<{ data: unknown; error: { code?: string } | null }>
}

export type PersistedStrengthSessionEvidenceReadV1 = StrengthSessionEvidenceResultV1
  | { readonly kind: 'not_found' }
  | {
    readonly kind: 'unavailable'
    readonly reason: 'persistence_unavailable'
    readonly missingFields: readonly []
  }

/**
 * Reads one RLS-filtered server projection and delegates all evidence validation
 * to the strict adapter. The browser never supplies timestamps or comparators.
 */
export async function readPersistedStrengthSessionEvidence(
  client: TrainingProgressionReadClient,
  sessionId: string,
  exerciseInstanceId: string,
): Promise<PersistedStrengthSessionEvidenceReadV1> {
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success
    || !TrainingStableIdV1Schema.safeParse(exerciseInstanceId).success) {
    return { kind: 'unavailable', reason: 'invalid_server_projection', missingFields: [] }
  }
  const { data, error } = await client.rpc('read_training_strength_evidence_projection', {
    p_session_id: sessionId,
    p_exercise_instance_id: exerciseInstanceId,
  })
  if (error) return { kind: 'unavailable', reason: 'persistence_unavailable', missingFields: [] }
  if (data === null) return { kind: 'not_found' }
  return adaptStrengthSessionEvidence(data)
}
