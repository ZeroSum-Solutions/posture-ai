import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Action = 'invite' | 'revoke' | 'approve-existing' | 'begin-mfa-recovery'

type InvitationIssuance = {
  invitation_id: string
  created: boolean
  delivery: 'invite' | 'recovery'
  target_email: string
  rollback_on_failure: boolean
}

type RecoveryPreparation = {
  user_id: string
  target_email: string
}

const REMOTE_ACK = 'I_ACKNOWLEDGE_THIS_MUTATES_AUTH'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function normalizePractitionerEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new Error('PRACTITIONER_EMAIL must be a valid email address')
  }
  return normalized
}

export function assertMutationTarget(urlString: string, remoteAck?: string): URL {
  const url = new URL(urlString)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (!local && remoteAck !== REMOTE_ACK) {
    throw new Error(
      `Refusing remote Auth mutation. Set PRACTITIONER_ACCESS_REMOTE_APPROVED=${REMOTE_ACK} only after explicit provider-change approval.`,
    )
  }
  return url
}

function emailReceipt(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 12)
}

async function rpcValue<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name} failed: ${error.message}`)
  return data as T
}

export async function invite(
  client: SupabaseClient,
  email: string,
  actor: string,
  appUrl: string,
  displayName: string | null,
) {
  const issuance = await rpcValue<InvitationIssuance>(
    client,
    'issue_practitioner_invitation_with_state',
    {
    p_email: email,
    p_display_name: displayName,
    p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    p_actor: actor,
    },
  )

  if (
    !issuance?.invitation_id ||
    !['invite', 'recovery'].includes(issuance.delivery) ||
    !issuance.target_email ||
    typeof issuance.created !== 'boolean' ||
    typeof issuance.rollback_on_failure !== 'boolean'
  ) {
    throw new Error('Invitation issuance returned an invalid state receipt')
  }

  const redirectBase = appUrl.replace(/\/+$/u, '')
  const { error } = issuance.delivery === 'invite'
    ? await client.auth.admin.inviteUserByEmail(issuance.target_email, {
        data: displayName ? { full_name: displayName } : undefined,
        redirectTo: `${redirectBase}/auth/accept-invite`,
      })
    : await client.auth.resetPasswordForEmail(issuance.target_email, {
        redirectTo: `${redirectBase}/auth/update-password`,
      })
  if (error) {
    // Roll back only a row minted by this invocation. A retry may be looking at
    // an already-provisioned account; revoking that user would turn a harmless
    // provider "already registered" response into an access-control incident.
    if (issuance.rollback_on_failure) {
      const { error: rollbackError } = await client.rpc('revoke_practitioner_access_by_bound_email', {
        p_email: email,
        p_reason: 'provider_invitation_failed',
        p_actor: actor,
      })
      if (rollbackError) {
        throw new Error(
          `Auth invitation failed: ${error.message}; allowlist rollback also failed: ${rollbackError.message}`,
        )
      }
    }
    throw new Error(`Auth invitation failed: ${error.message}`)
  }
}

export async function revoke(client: SupabaseClient, email: string, actor: string, reason: string) {
  // Database membership is revoked first so existing JWTs lose data access even
  // if the provider ban fails or an access token remains cryptographically valid.
  const userId = await rpcValue<string | null>(client, 'revoke_practitioner_access_by_bound_email', {
    p_email: email,
    p_reason: reason,
    p_actor: actor,
  })
  // A still-pending invitation has no provider identity to ban. The database
  // revocation is complete and authoritative in that case.
  if (!userId) return
  const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
  if (error) throw new Error(`Database access was revoked, but provider ban failed: ${error.message}`)
}

async function approveExisting(client: SupabaseClient, email: string, actor: string) {
  await rpcValue<string>(client, 'approve_existing_practitioner', {
    p_email: email,
    p_actor: actor,
  })
}

export async function beginMfaRecovery(
  client: SupabaseClient,
  email: string,
  actor: string,
  reason: string,
  appUrl: string,
) {
  // Transition to recovery_pending before touching provider factors. That state
  // is denied by proxy, APIs, and RLS, so partial failure remains fail-closed.
  const preparation = await rpcValue<RecoveryPreparation>(
    client,
    'begin_practitioner_mfa_recovery_by_bound_email',
    {
    p_email: email,
    p_reason: reason,
    p_actor: actor,
    },
  )
  if (!preparation?.user_id || !preparation.target_email) {
    throw new Error('MFA recovery returned an invalid state receipt')
  }
  const userId = preparation.user_id
  const { data, error } = await client.auth.admin.mfa.listFactors({ userId })
  if (error) throw new Error(`Access is recovery-pending, but factor listing failed: ${error.message}`)
  for (const factor of data.factors) {
    const { error: deleteError } = await client.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id,
    })
    if (deleteError) {
      throw new Error(`Access remains recovery-pending; factor deletion failed: ${deleteError.message}`)
    }
  }

  // Only after every old factor is gone do we freeze the provider-reset
  // boundary. Completion additionally requires an email recovery OTP and a new
  // TOTP verified after this timestamp, so an old Auth token cannot win a race
  // by refreshing or enrolling its own factor.
  await rpcValue<string>(client, 'finalize_practitioner_mfa_recovery', {
    p_user_id: userId,
    p_actor: actor,
  })

  const { error: recoveryEmailError } = await client.auth.resetPasswordForEmail(
    preparation.target_email,
    { redirectTo: `${appUrl.replace(/\/+$/u, '')}/auth/update-password` },
  )
  if (recoveryEmailError) {
    throw new Error(
      `Access remains recovery-pending; password recovery delivery failed: ${recoveryEmailError.message}`,
    )
  }
}

async function main() {
  const action = required('PRACTITIONER_ACCESS_ACTION') as Action
  if (!['invite', 'revoke', 'approve-existing', 'begin-mfa-recovery'].includes(action)) {
    throw new Error('PRACTITIONER_ACCESS_ACTION must be invite, revoke, approve-existing, or begin-mfa-recovery')
  }

  const email = normalizePractitionerEmail(required('PRACTITIONER_EMAIL'))
  const actor = required('PRACTITIONER_ACCESS_ACTOR')
  const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL')
  assertMutationTarget(supabaseUrl, process.env.PRACTITIONER_ACCESS_REMOTE_APPROVED)
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  if (action === 'invite') {
    await invite(
      client,
      email,
      actor,
      required('NEXT_PUBLIC_APP_URL'),
      process.env.PRACTITIONER_DISPLAY_NAME?.trim() || null,
    )
  } else if (action === 'revoke') {
    await revoke(client, email, actor, required('PRACTITIONER_ACCESS_REASON'))
  } else if (action === 'approve-existing') {
    await approveExisting(client, email, actor)
  } else {
    await beginMfaRecovery(
      client,
      email,
      actor,
      required('PRACTITIONER_ACCESS_REASON'),
      required('NEXT_PUBLIC_APP_URL'),
    )
  }

  process.stdout.write(`${JSON.stringify({ action, email_receipt: emailReceipt(email), status: 'completed' })}\n`)
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
