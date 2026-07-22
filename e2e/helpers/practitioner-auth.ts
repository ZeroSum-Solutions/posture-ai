import type { SupabaseClient } from '@supabase/supabase-js'
import { totpCode } from '../../scripts/testing/totp'

const E2E_ACTOR = 'local-e2e-auth-fixture'

function assertLocal(urlString: string) {
  const url = new URL(urlString)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Practitioner Auth E2E fixtures require local Supabase')
  }
}

async function findUser(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const match = data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < 100) return null
  }
  throw new Error('Local Auth fixture user search exceeded 1,000 users')
}

/**
 * Provision one fresh local invited account through the same allowlist + Auth
 * trigger authority used by the operator flow. Callers use a unique email so
 * fixture setup never deletes an Auth user or cascades into clinical records.
 */
export async function provisionLocalInvitedPractitioner(input: {
  admin: SupabaseClient
  supabaseUrl: string
  email: string
  password: string
  displayName?: string
}) {
  const { admin, supabaseUrl, password } = input
  assertLocal(supabaseUrl)
  const email = input.email.trim().toLowerCase()
  const existing = await findUser(admin, email)
  if (existing) {
    throw new Error('Local invited fixture email already exists; use a fresh unique email')
  }

  const { error: inviteError } = await admin.rpc('issue_practitioner_invitation_with_state', {
    p_email: email,
    p_display_name: input.displayName ?? 'E2E Practitioner',
    p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    p_actor: E2E_ACTOR,
  })
  if (inviteError) throw new Error(`Local invitation fixture failed: ${inviteError.message}`)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: input.displayName ?? 'E2E Practitioner' },
  })
  if (error || !data.user) throw new Error(`Local invited user creation failed: ${error?.message}`)
  return data.user
}

/** Enroll TOTP, obtain an AAL2 session, and atomically activate the invitation. */
export async function activateLocalPractitionerAal2(client: SupabaseClient): Promise<string> {
  const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Posture AI local E2E',
  })
  if (enrollError) throw enrollError

  const secret = enrollment.totp.secret
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollment.id,
  })
  if (challengeError) throw challengeError
  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollment.id,
    challengeId: challenge.id,
    code: totpCode(secret),
  })
  if (verifyError) throw verifyError

  const { data: completion, error: completionError } = await client.rpc(
    'complete_practitioner_invitation',
  )
  if (completionError) throw completionError
  if (!['activated', 'already_active'].includes(String(completion))) {
    throw new Error(`Invitation activation failed closed: ${String(completion)}`)
  }
  return secret
}
