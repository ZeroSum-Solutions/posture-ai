export type TrainingAction =
  | 'profile:read'
  | 'profile:write'
  | 'program:self_publish'
  | 'program:coach_publish'
  | 'session:read'
  | 'set_log:write'
  | 'session:complete'
  | 'history:read'
  | 'relationship:revoke'
  | 'eligibility:clear'

export type TrainingPrincipal =
  | {
      kind: 'user'
      userId: string
      assuranceLevel: 'aal1' | 'aal2'
    }
  | {
      kind: 'share_token'
      tokenId: string
    }

export interface TrainingSubjectAccessRecord {
  id: string
  ownerUserId: string
  status: 'invited' | 'active' | 'suspended' | 'revoked'
  revokedAt: string | null
  deletedAt: string | null
}

export interface ClientAccountAccessRecord {
  subjectId: string
  clientId: string
  status: 'active' | 'revoked'
  revokedAt: string | null
}

export interface AuthorizeTrainingActorInput {
  principal: TrainingPrincipal
  subject: TrainingSubjectAccessRecord
  clientAccount: ClientAccountAccessRecord | null
  action: TrainingAction
}

export type TrainingAuthorizationDenial =
  | 'authenticated_user_required'
  | 'aal2_required'
  | 'subject_unavailable'
  | 'subject_forbidden'
  | 'action_forbidden'
  | 'invalid_client_bridge'

export type TrainingAuthorization =
  | {
      ok: true
      actorKind: 'athlete'
      userId: string
      subjectId: string
      clientId: string | null
      practitionerId: null
      permissions: TrainingAction[]
    }
  | {
      ok: false
      code: TrainingAuthorizationDenial
    }

const ATHLETE_ACTIONS = new Set<TrainingAction>([
  'profile:read',
  'profile:write',
  'program:self_publish',
  'session:read',
  'set_log:write',
  'session:complete',
  'history:read',
  'relationship:revoke',
])

/**
 * Applies the identity-foundation authorization rules to trusted rows already
 * loaded by server code. Database adapters remain responsible for loading the
 * subject and optional bridge by their keys; request-supplied actor/client IDs
 * are never inputs to this decision.
 */
export function authorizeTrainingActor(
  input: AuthorizeTrainingActorInput,
): TrainingAuthorization {
  const { principal, subject, clientAccount, action } = input

  if (principal.kind !== 'user') {
    return { ok: false, code: 'authenticated_user_required' }
  }

  if (principal.assuranceLevel !== 'aal2') {
    return { ok: false, code: 'aal2_required' }
  }

  if (
    subject.status !== 'active'
    || subject.revokedAt !== null
    || subject.deletedAt !== null
  ) {
    return { ok: false, code: 'subject_unavailable' }
  }

  if (subject.ownerUserId !== principal.userId) {
    return { ok: false, code: 'subject_forbidden' }
  }

  if (!ATHLETE_ACTIONS.has(action)) {
    return { ok: false, code: 'action_forbidden' }
  }

  if (clientAccount !== null && clientAccount.subjectId !== subject.id) {
    return { ok: false, code: 'invalid_client_bridge' }
  }

  const clientId = clientAccount?.status === 'active'
    && clientAccount.revokedAt === null
    ? clientAccount.clientId
    : null

  return {
    ok: true,
    actorKind: 'athlete',
    userId: principal.userId,
    subjectId: subject.id,
    clientId,
    practitionerId: null,
    permissions: [action],
  }
}
