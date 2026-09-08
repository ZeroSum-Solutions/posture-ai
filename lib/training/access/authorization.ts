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

export interface PractitionerAccessRecord {
  id: string
  role: 'practitioner' | string
  accessStatus: 'active' | 'review_required' | 'invited' | 'recovery_pending' | 'suspended' | 'revoked'
  sessionIsCurrent: boolean
}

export interface CoachingRelationshipAccessRecord {
  id: string
  subjectId: string
  practitionerId: string
  status: 'active' | 'revoked'
  permissions: readonly TrainingAction[]
  startedAt: string
  endedAt: string | null
  revision: number
}

export interface AuthorizeTrainingActorInput {
  principal: TrainingPrincipal
  subject: TrainingSubjectAccessRecord
  clientAccount: ClientAccountAccessRecord | null
  practitioner?: PractitionerAccessRecord | null
  coachingRelationship?: CoachingRelationshipAccessRecord | null
  action: TrainingAction
}

export type TrainingAuthorizationDenial =
  | 'authenticated_user_required'
  | 'aal2_required'
  | 'subject_unavailable'
  | 'subject_forbidden'
  | 'action_forbidden'
  | 'invalid_client_bridge'
  | 'practitioner_unavailable'
  | 'relationship_unavailable'
  | 'invalid_coaching_relationship'

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
      ok: true
      actorKind: 'coach'
      userId: string
      subjectId: string
      clientId: string | null
      practitionerId: string
      relationshipId: string
      relationshipRevision: number
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

const COACH_ACTIONS = new Set<TrainingAction>([
  'profile:read',
  'profile:write',
  'program:coach_publish',
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
  const {
    principal,
    subject,
    clientAccount,
    practitioner = null,
    coachingRelationship = null,
    action,
  } = input

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

  if (clientAccount !== null && clientAccount.subjectId !== subject.id) {
    return { ok: false, code: 'invalid_client_bridge' }
  }

  const clientId = clientAccount?.status === 'active'
    && clientAccount.revokedAt === null
    ? clientAccount.clientId
    : null

  if (subject.ownerUserId === principal.userId) {
    if (!ATHLETE_ACTIONS.has(action)) {
      return { ok: false, code: 'action_forbidden' }
    }

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

  if (practitioner === null) {
    return { ok: false, code: 'subject_forbidden' }
  }
  if (
    practitioner.id !== principal.userId
    || practitioner.role !== 'practitioner'
    || practitioner.accessStatus !== 'active'
    || !practitioner.sessionIsCurrent
  ) {
    return { ok: false, code: 'practitioner_unavailable' }
  }
  if (coachingRelationship === null) {
    return { ok: false, code: 'relationship_unavailable' }
  }
  if (
    coachingRelationship.subjectId !== subject.id
    || coachingRelationship.practitionerId !== practitioner.id
  ) {
    return { ok: false, code: 'invalid_coaching_relationship' }
  }
  if (
    coachingRelationship.status !== 'active'
    || coachingRelationship.endedAt !== null
    || !Number.isSafeInteger(coachingRelationship.revision)
    || coachingRelationship.revision < 1
  ) {
    return { ok: false, code: 'relationship_unavailable' }
  }
  if (
    !COACH_ACTIONS.has(action)
    || !coachingRelationship.permissions.includes(action)
  ) {
    return { ok: false, code: 'action_forbidden' }
  }

  return {
    ok: true,
    actorKind: 'coach',
    userId: principal.userId,
    subjectId: subject.id,
    clientId,
    practitionerId: practitioner.id,
    relationshipId: coachingRelationship.id,
    relationshipRevision: coachingRelationship.revision,
    permissions: [action],
  }
}
