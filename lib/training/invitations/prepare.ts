import { z } from 'zod'

export const TRAINING_COACH_PERMISSIONS = [
  'subject:read',
  'client_link:read',
  'profile:read',
  'profile:write',
  'program:coach_publish',
  'session:read',
  'set_log:write',
  'session:complete',
  'history:read',
  'relationship:revoke',
] as const

export const TrainingCoachPermissionSchema = z.enum(TRAINING_COACH_PERMISSIONS)

export const CoachAthleteInvitationPrepareInputSchema = z.object({
  requestId: z.string().uuid(),
  clientId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  permissions: z.array(TrainingCoachPermissionSchema).min(1).max(TRAINING_COACH_PERMISSIONS.length),
}).strict().superRefine((value, context) => {
  if (new Set(value.permissions).size !== value.permissions.length) {
    context.addIssue({ code: 'custom', path: ['permissions'], message: 'Permissions must be unique.' })
  }
})

const PrepareProjectionSchema = z.object({
  status: z.enum(['pending', 'provisioned']),
  invitationId: z.string().uuid(),
  clientId: z.string().uuid(),
  emailNormalized: z.string().email().max(254),
  permissions: z.array(TrainingCoachPermissionSchema).min(1),
  expiresAt: z.string().datetime({ offset: true }),
  provisionedUserId: z.string().uuid().nullable(),
  subjectId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  const complete = value.provisionedUserId !== null && value.subjectId !== null
  if ((value.status === 'provisioned') !== complete) {
    context.addIssue({ code: 'custom', message: 'Invitation provisioning fields do not match status.' })
  }
})

export const CoachAthleteInvitationPreparedSchema = z.object({
  status: z.literal('prepared'),
  invitationId: z.string().uuid(),
  invitationUrl: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict()

export type CoachAthleteInvitationPrepareInput = z.infer<typeof CoachAthleteInvitationPrepareInputSchema>
export type CoachAthleteInvitationPrepared = z.infer<typeof CoachAthleteInvitationPreparedSchema>
type PrepareProjection = z.infer<typeof PrepareProjectionSchema>

export type GeneratedInvitationLink = {
  userId: string
  email: string
  tokenHash: string
  actionLink: string
  redirectTo: string
  verificationType: 'invite' | 'recovery'
}

export type InvitationPrepareDependencies = {
  prepare(input: CoachAthleteInvitationPrepareInput): Promise<unknown>
  generateLink(input: {
    type: 'invite' | 'recovery'
    email: string
    redirectTo: string
  }): Promise<GeneratedInvitationLink>
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

type AdminClient = {
  auth: {
    admin: {
      generateLink(args: {
        type: 'invite' | 'recovery'
        email: string
        options: { redirectTo: string }
      }): Promise<{
        data: {
          properties: null | {
            action_link: string
            hashed_token: string
            redirect_to: string
            verification_type: string
          }
          user: null | { id: string; email?: string }
        }
        error: unknown
      }>
    }
  }
}

export type InvitationPrepareErrorCode =
  | 'invalid_invitation_request'
  | 'invitation_prepare_binding_failed'
  | 'invitation_link_unavailable'

export class InvitationPrepareError extends Error {
  constructor(readonly code: InvitationPrepareErrorCode) {
    super(code)
  }
}

export function createSupabaseInvitationPrepareDependencies(
  sessionClient: RpcClient,
  adminClient: AdminClient,
): InvitationPrepareDependencies {
  return {
    async prepare(input) {
      const { data, error } = await sessionClient.rpc('prepare_coach_athlete_invitation', {
        p_request_id: input.requestId,
        p_target_client_id: input.clientId,
        p_email: input.email,
        p_permissions: input.permissions,
      })
      if (error) throw error
      return data
    },
    async generateLink(input) {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: input.type,
        email: input.email,
        options: { redirectTo: input.redirectTo },
      })
      if (error || !data.properties || !data.user?.email) {
        throw new InvitationPrepareError('invitation_link_unavailable')
      }
      return {
        userId: data.user.id,
        email: data.user.email,
        tokenHash: data.properties.hashed_token,
        actionLink: data.properties.action_link,
        redirectTo: data.properties.redirect_to,
        verificationType: data.properties.verification_type as 'invite' | 'recovery',
      }
    },
  }
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function assertProjection(
  value: unknown,
  input: CoachAthleteInvitationPrepareInput,
  previous?: PrepareProjection,
): PrepareProjection {
  const parsed = PrepareProjectionSchema.safeParse(value)
  if (!parsed.success) throw new InvitationPrepareError('invitation_prepare_binding_failed')
  const projection = parsed.data
  const expectedPermissions = [...input.permissions].sort()
  if (
    projection.clientId !== input.clientId
    || projection.emailNormalized !== input.email
    || !sameStrings(projection.permissions, expectedPermissions)
    || (previous && (
      projection.invitationId !== previous.invitationId
      || projection.clientId !== previous.clientId
      || projection.emailNormalized !== previous.emailNormalized
      || projection.expiresAt !== previous.expiresAt
      || !sameStrings(projection.permissions, previous.permissions)
    ))
  ) throw new InvitationPrepareError('invitation_prepare_binding_failed')
  return projection
}

function validateGeneratedLink(
  value: GeneratedInvitationLink,
  projection: PrepareProjection,
  expectedType: 'invite' | 'recovery',
  redirectTo: string,
) {
  let actionLink: URL
  try { actionLink = new URL(value.actionLink) } catch {
    throw new InvitationPrepareError('invitation_link_unavailable')
  }
  const localHttp = actionLink.protocol === 'http:'
    && (actionLink.hostname === 'localhost' || actionLink.hostname === '127.0.0.1')
  if (
    (actionLink.protocol !== 'https:' && !localHttp)
    || !z.string().min(1).max(2048).regex(/^\S+$/).safeParse(value.tokenHash).success
    || actionLink.searchParams.get('token') !== value.tokenHash
    || actionLink.searchParams.get('type') !== expectedType
    || actionLink.searchParams.get('redirect_to') !== redirectTo
    || value.verificationType !== expectedType
    || value.redirectTo !== redirectTo
    || value.email.trim().toLowerCase() !== projection.emailNormalized
    || !z.string().uuid().safeParse(value.userId).success
  ) throw new InvitationPrepareError('invitation_link_unavailable')
}

function buildApplicationConfirmationUrl(
  siteOrigin: URL,
  tokenHash: string,
  verificationType: 'invite' | 'recovery',
) {
  const confirmation = new URL('/auth/confirm', siteOrigin)
  confirmation.searchParams.set('token_hash', tokenHash)
  confirmation.searchParams.set('type', verificationType)
  confirmation.searchParams.set('next', 'athlete-invite')
  return confirmation.toString()
}

export async function prepareCoachAthleteInvitation(
  rawInput: unknown,
  actorUserId: string,
  siteOrigin: string,
  dependencies: InvitationPrepareDependencies,
): Promise<CoachAthleteInvitationPrepared> {
  const inputResult = CoachAthleteInvitationPrepareInputSchema.safeParse(rawInput)
  if (!inputResult.success || !z.string().uuid().safeParse(actorUserId).success) {
    throw new InvitationPrepareError('invalid_invitation_request')
  }
  const input = {
    ...inputResult.data,
    permissions: [...inputResult.data.permissions].sort() as typeof inputResult.data.permissions,
  }
  const origin = new URL(siteOrigin)
  const redirectTo = new URL('/train/accept-invite', origin).toString()

  const initial = assertProjection(await dependencies.prepare(input), input)
  const linkType = initial.status === 'pending' ? 'invite' : 'recovery'
  let generated: GeneratedInvitationLink
  try {
    generated = await dependencies.generateLink({
      type: linkType,
      email: initial.emailNormalized,
      redirectTo,
    })
  } catch {
    throw new InvitationPrepareError('invitation_link_unavailable')
  }
  validateGeneratedLink(generated, initial, linkType, redirectTo)

  const final = assertProjection(await dependencies.prepare(input), input, initial)
  if (
    final.status !== 'provisioned'
    || final.provisionedUserId !== generated.userId
    || final.subjectId === null
  ) throw new InvitationPrepareError('invitation_prepare_binding_failed')

  return CoachAthleteInvitationPreparedSchema.parse({
    status: 'prepared',
    invitationId: final.invitationId,
    invitationUrl: buildApplicationConfirmationUrl(origin, generated.tokenHash, linkType),
    expiresAt: final.expiresAt,
  })
}
