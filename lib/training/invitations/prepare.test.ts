import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseInvitationPrepareDependencies,
  InvitationPrepareError,
  prepareCoachAthleteInvitation,
  type InvitationPrepareDependencies,
} from './prepare'

const actorUserId = '11000000-0000-4000-8000-000000000001'
const requestId = '12000000-0000-4000-8000-000000000001'
const clientId = '13000000-0000-4000-8000-000000000001'
const invitationId = '14000000-0000-4000-8000-000000000001'
const athleteUserId = '15000000-0000-4000-8000-000000000001'
const subjectId = '16000000-0000-4000-8000-000000000001'
const expiresAt = '2026-09-16T18:00:00.000000Z'
const permissions = ['profile:read', 'program:coach_publish'] as const

const pending = {
  status: 'pending' as const,
  invitationId,
  clientId,
  emailNormalized: 'athlete@example.invalid',
  permissions: [...permissions],
  expiresAt,
  provisionedUserId: null,
  subjectId: null,
}

const provisioned = {
  ...pending,
  status: 'provisioned' as const,
  provisionedUserId: athleteUserId,
  subjectId,
}

type RawProjection = typeof pending | typeof provisioned

function dependencies(
  first: RawProjection = pending,
  second: RawProjection = provisioned,
): InvitationPrepareDependencies & {
  prepare: ReturnType<typeof vi.fn>
  generateLink: ReturnType<typeof vi.fn>
} {
  return {
    prepare: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    generateLink: vi.fn().mockResolvedValue({
      userId: athleteUserId,
      email: 'athlete@example.invalid',
      tokenHash: 'opaque-token-hash',
      actionLink: 'https://auth.example.invalid/auth/v1/verify?type=invite&token=opaque-token-hash&redirect_to=https%3A%2F%2Fapp.example.invalid%2Ftrain%2Faccept-invite',
      redirectTo: 'https://app.example.invalid/train/accept-invite',
      verificationType: first.status === 'pending' ? 'invite' : 'recovery',
    }),
  }
}

const input = {
  requestId,
  clientId,
  email: ' Athlete@Example.Invalid ',
  permissions: [...permissions],
}

describe('prepareCoachAthleteInvitation', () => {
  it('binds the authenticated RPC and admin link generator without sending email', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: pending, error: null })
    const generateLink = vi.fn().mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://auth.example.invalid/auth/v1/verify?token=secret',
          hashed_token: 'opaque-token-hash',
          redirect_to: 'https://app.example.invalid/train/accept-invite',
          verification_type: 'invite',
        },
        user: { id: athleteUserId, email: 'athlete@example.invalid' },
      },
      error: null,
    })
    const deps = createSupabaseInvitationPrepareDependencies(
      { rpc }, { auth: { admin: { generateLink } } },
    )

    await expect(deps.prepare({ ...input, email: 'athlete@example.invalid' })).resolves.toEqual(pending)
    expect(rpc).toHaveBeenCalledWith('prepare_coach_athlete_invitation', {
      p_request_id: requestId,
      p_target_client_id: clientId,
      p_email: 'athlete@example.invalid',
      p_permissions: [...permissions],
    })
    await expect(deps.generateLink({
      type: 'invite', email: 'athlete@example.invalid',
      redirectTo: 'https://app.example.invalid/train/accept-invite',
    })).resolves.toMatchObject({ userId: athleteUserId, verificationType: 'invite' })
    expect(generateLink).toHaveBeenCalledWith({
      type: 'invite', email: 'athlete@example.invalid',
      options: { redirectTo: 'https://app.example.invalid/train/accept-invite' },
    })
  })

  it('generates an invite without delivery and returns only after exact post-generation binding', async () => {
    const deps = dependencies()

    await expect(prepareCoachAthleteInvitation(input, actorUserId, 'https://app.example.invalid', deps))
      .resolves.toEqual({
        status: 'prepared',
        invitationId,
        invitationUrl: 'https://app.example.invalid/auth/confirm?token_hash=opaque-token-hash&type=invite&next=athlete-invite',
        expiresAt,
      })

    expect(deps.prepare).toHaveBeenNthCalledWith(1, {
      requestId, clientId, email: 'athlete@example.invalid', permissions: [...permissions],
    })
    expect(deps.generateLink).toHaveBeenCalledWith({
      type: 'invite', email: 'athlete@example.invalid', redirectTo: 'https://app.example.invalid/train/accept-invite',
    })
    expect(deps.prepare).toHaveBeenNthCalledWith(2, {
      requestId, clientId, email: 'athlete@example.invalid', permissions: [...permissions],
    })
  })

  it('recovers a lost response with a recovery link for the exact provisioned user', async () => {
    const deps = dependencies(provisioned, provisioned)
    deps.generateLink.mockResolvedValueOnce({
      userId: athleteUserId,
      email: 'athlete@example.invalid',
      tokenHash: 'opaque-recovery-token-hash',
      actionLink: 'https://auth.example.invalid/auth/v1/verify?type=recovery&token=opaque-recovery-token-hash&redirect_to=https%3A%2F%2Fapp.example.invalid%2Ftrain%2Faccept-invite',
      redirectTo: 'https://app.example.invalid/train/accept-invite',
      verificationType: 'recovery',
    })

    await expect(prepareCoachAthleteInvitation(input, actorUserId, 'https://app.example.invalid', deps))
      .resolves.toMatchObject({
        status: 'prepared',
        invitationId,
        invitationUrl: 'https://app.example.invalid/auth/confirm?token_hash=opaque-recovery-token-hash&type=recovery&next=athlete-invite',
      })
    expect(deps.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: 'recovery' }))
  })

  it.each([
    [{ ...provisioned, invitationId: '24000000-0000-4000-8000-000000000001' }, 'invitation_prepare_binding_failed'],
    [{ ...provisioned, permissions: ['profile:read'] }, 'invitation_prepare_binding_failed'],
    [{ ...provisioned, provisionedUserId: '25000000-0000-4000-8000-000000000001' }, 'invitation_prepare_binding_failed'],
  ])('refuses to return a link when the authoritative post-generation receipt changes', async (changed, code) => {
    const deps = dependencies(pending, changed as typeof provisioned)
    await expect(prepareCoachAthleteInvitation(input, actorUserId, 'https://app.example.invalid', deps))
      .rejects.toMatchObject({ code })
  })

  it('rejects mismatched provider identity, link kind, redirect, and untrusted URL before returning the secret', async () => {
    for (const generated of [
      { userId: '25000000-0000-4000-8000-000000000001', email: pending.emailNormalized, tokenHash: 'opaque-token-hash', verificationType: 'invite', redirectTo: 'https://app.example.invalid/train/accept-invite', actionLink: 'https://auth.example.invalid/auth/v1/verify' },
      { userId: athleteUserId, email: pending.emailNormalized, tokenHash: 'opaque-token-hash', verificationType: 'recovery', redirectTo: 'https://app.example.invalid/train/accept-invite', actionLink: 'https://auth.example.invalid/auth/v1/verify' },
      { userId: athleteUserId, email: pending.emailNormalized, tokenHash: 'opaque-token-hash', verificationType: 'invite', redirectTo: 'https://evil.example.invalid', actionLink: 'https://auth.example.invalid/auth/v1/verify' },
      { userId: athleteUserId, email: pending.emailNormalized, tokenHash: 'opaque-token-hash', verificationType: 'invite', redirectTo: 'https://app.example.invalid/train/accept-invite', actionLink: 'javascript:alert(1)' },
      { userId: athleteUserId, email: pending.emailNormalized, tokenHash: '', verificationType: 'invite', redirectTo: 'https://app.example.invalid/train/accept-invite', actionLink: 'https://auth.example.invalid/auth/v1/verify' },
    ]) {
      const deps = dependencies()
      deps.generateLink.mockResolvedValueOnce(generated as never)
      await expect(prepareCoachAthleteInvitation(input, actorUserId, 'https://app.example.invalid', deps))
        .rejects.toBeInstanceOf(InvitationPrepareError)
      expect(deps.prepare.mock.calls.length).toBeLessThanOrEqual(2)
    }
  })

  it('validates and canonicalizes before any side effect', async () => {
    const deps = dependencies()
    await expect(prepareCoachAthleteInvitation(
      { ...input, permissions: ['profile:read', 'profile:read'] }, actorUserId, 'https://app.example.invalid', deps,
    )).rejects.toMatchObject({ code: 'invalid_invitation_request' })
    expect(deps.prepare).not.toHaveBeenCalled()
    expect(deps.generateLink).not.toHaveBeenCalled()
  })
})
