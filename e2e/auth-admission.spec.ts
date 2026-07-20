import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import pg from 'pg'
import { totpCode } from '../scripts/testing/totp'
import {
  activateLocalPractitionerAal2,
  provisionLocalInvitedPractitioner,
} from './helpers/practitioner-auth'

const PASSWORD = 'TestPass1234!'
const RECOVERED_PASSWORD = 'RecoveredPass1234!'
const REISSUED_PASSWORD = 'ReissuedPass1234!'

function localConfig() {
  const url = process.env.E2E_SUPABASE_URL
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url?.startsWith('http://127.0.0.1') || !anonKey || !serviceKey) {
    throw new Error('Auth admission E2E requires the local Supabase stack')
  }
  return { url, anonKey, serviceKey }
}

function browserClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function enrollAndVerifyTotp(client: SupabaseClient, friendlyName: string) {
  const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })
  if (enrollError) throw enrollError
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
    factorId: enrollment.id,
  })
  if (challengeError) throw challengeError
  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollment.id,
    challengeId: challenge.id,
    code: totpCode(enrollment.totp.secret),
  })
  if (verifyError) throw verifyError
  return enrollment.id
}

async function expectRecoveryTransitionDenied(input: {
  dbUrl: string
  userId: string
  email: string
  issuedAt: number
  amr: Array<{ method: string; timestamp: number }>
  message: string
}) {
  const connection = new pg.Client({ connectionString: input.dbUrl })
  await connection.connect()
  try {
    await connection.query('BEGIN')
    await connection.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({
        sub: input.userId,
        email: input.email,
        role: 'authenticated',
        aal: 'aal2',
        iat: input.issuedAt,
        amr: input.amr,
      })],
    )
    await expect(connection.query(
      `UPDATE public.practitioners SET access_status = 'active' WHERE id = $1`,
      [input.userId],
    )).rejects.toThrow(input.message)
    await connection.query('ROLLBACK')
  } finally {
    await connection.query('ROLLBACK').catch(() => undefined)
    await connection.end()
  }
}

async function activeFixture(input: {
  admin: SupabaseClient
  url: string
  anonKey: string
  email: string
  displayName: string
}): Promise<{ user: User; client: SupabaseClient }> {
  const user = await provisionLocalInvitedPractitioner({
    admin: input.admin,
    supabaseUrl: input.url,
    email: input.email,
    password: PASSWORD,
    displayName: input.displayName,
  })
  const client = browserClient(input.url, input.anonKey)
  const { error: signInError } = await client.auth.signInWithPassword({
    email: input.email,
    password: PASSWORD,
  })
  if (signInError) throw signInError
  await activateLocalPractitionerAal2(client)
  return { user, client }
}

test.describe('invitation-only practitioner admission', () => {
  test('accepts a real invite token through password setup and MFA before activation', async ({ browser }, testInfo) => {
    test.setTimeout(60_000)
    const { url, serviceKey } = localConfig()
    const dbUrl = process.env.E2E_SUPABASE_DB_URL
    if (!dbUrl) throw new Error('E2E_SUPABASE_DB_URL is required')
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const email = `invite-ui+${Date.now()}-${process.pid}@postureai.test`
    expect((await admin.rpc('issue_practitioner_invitation_with_state', {
      p_email: email,
      p_display_name: 'Invite UI Practitioner',
      p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      p_actor: 'local-e2e-invite-ui',
    })).error).toBeNull()

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { full_name: 'Invite UI Practitioner' } },
    })
    expect(linkError).toBeNull()
    if (!link?.properties?.hashed_token || !link.user) {
      throw new Error('Local Auth did not return an invite token and user')
    }
    const inviteTokenHash = link.properties.hashed_token
    const invitedUserId = link.user.id

    const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL) })
    const page = await context.newPage()
    const pool = new pg.Pool({ connectionString: dbUrl })
    try {
      await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(inviteTokenHash)}`)
      await page.waitForURL(/\/auth\/accept-invite/)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await page.getByLabel('Confirm password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Continue to multi-factor setup' }).click()
      await page.waitForURL(/\/auth\/mfa/)
      await expect(page.getByAltText(/QR code for Posture AI/i)).toBeVisible()

      // The user-facing surface intentionally never prints the TOTP secret. The
      // local-only E2E driver reads it directly from the local Auth database so
      // it can submit a real code without adding a production test bypass.
      const factor = await pool.query<{ secret: string }>(
        `SELECT secret FROM auth.mfa_factors
          WHERE user_id = $1 AND factor_type = 'totp' AND status = 'unverified'
          ORDER BY created_at DESC LIMIT 1`,
        [invitedUserId],
      )
      expect(factor.rows).toHaveLength(1)
      await page.route('**/api/auth/complete-invitation', (route) => route.abort())
      await page.getByLabel('Authenticator code').fill(totpCode(factor.rows[0]!.secret))
      await page.getByRole('button', { name: 'Verify and continue' }).click()

      // Simulate a transient completion outage after the real TOTP challenge.
      // A protected navigation must route the still-invited AAL2 session back to
      // MFA without signing it out; the own-status RPC exists for this exact RLS
      // state. Keep completion blocked so the intermediate redirect is observable.
      await expect(page.getByText('Could not reach the access service', { exact: false })).toBeVisible()
      await page.goto('/dashboard')
      await page.waitForURL(/\/auth\/mfa/)
      await expect(page.getByText('Could not reach the access service', { exact: false })).toBeVisible()

      await page.unroute('**/api/auth/complete-invitation')
      await page.getByRole('button', { name: 'Try again' }).click()
      await page.waitForURL((current) => current.pathname === '/onboarding', { timeout: 15_000 })

      const { data: practitioner, error: practitionerError } = await admin
        .from('practitioners')
        .select('access_status, role, invitation_id')
        .eq('id', invitedUserId)
        .single()
      expect(practitionerError).toBeNull()
      expect(practitioner).toMatchObject({ access_status: 'active', role: 'practitioner' })
      expect(practitioner?.invitation_id).toBeTruthy()

      // A concurrent Auth-email update must not make recovery target the wrong
      // identity. The wrapper waits for the Auth-row lock, then continues by the
      // invitation-bound immutable user id and returns the newly committed email.
      const changedEmail = `invite-ui-changed+${Date.now()}-${process.pid}@postureai.test`
      const connection = await pool.connect()
      try {
        await connection.query('BEGIN')
        await connection.query(
          `UPDATE auth.users SET email = $1, updated_at = clock_timestamp() WHERE id = $2`,
          [changedEmail, invitedUserId],
        )
        let recoverySettled = false
        const recoveryPromise = admin.rpc('begin_practitioner_mfa_recovery_by_bound_email', {
          p_email: email,
          p_reason: 'e2e concurrent email recovery',
          p_actor: 'local-e2e-concurrent-recovery',
        }).then((result) => {
          recoverySettled = true
          return result
        })
        await new Promise((resolve) => setTimeout(resolve, 150))
        expect(recoverySettled).toBe(false)
        await connection.query('COMMIT')
        const { data: recovery, error: recoveryError } = await recoveryPromise
        expect(recoveryError).toBeNull()
        expect(recovery).toMatchObject({ user_id: invitedUserId, target_email: changedEmail })
      } finally {
        await connection.query('ROLLBACK').catch(() => undefined)
        connection.release()
      }
    } finally {
      await pool.end()
      await context.close()
    }
  })

  test('enforces signup, AAL2, tenant, recovery, role, and revocation boundaries in the real database', async () => {
    test.setTimeout(90_000)
    const { url, anonKey, serviceKey } = localConfig()
    const dbUrl = process.env.E2E_SUPABASE_DB_URL
    if (!dbUrl) throw new Error('E2E_SUPABASE_DB_URL is required')
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const nonce = `${Date.now()}-${process.pid}`

    // Public signup is disabled at Auth, and even the admin creation surface is
    // rejected by the database hook unless an operator invitation exists.
    const publicClient = browserClient(url, anonKey)
    const uninvitedEmail = `uninvited+${nonce}@postureai.test`
    const { error: publicSignupError } = await publicClient.auth.signUp({
      email: uninvitedEmail,
      password: PASSWORD,
    })
    expect(publicSignupError).toBeTruthy()
    const { error: adminCreateError } = await admin.auth.admin.createUser({
      email: `admin-bypass+${nonce}@postureai.test`,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(adminCreateError).toBeTruthy()

    const emailA = `practitioner-a+${nonce}@postureai.test`
    const emailB = `practitioner-b+${nonce}@postureai.test`
    const a = await activeFixture({ admin, url, anonKey, email: emailA, displayName: 'Practitioner A' })
    const b = await activeFixture({ admin, url, anonKey, email: emailB, displayName: 'Practitioner B' })

    const { data: orgs, error: orgError } = await admin
      .from('organizations')
      .insert([
        { name: `Org A ${nonce}`, is_covered_entity: false, baa_status: 'not_required' },
        { name: `Org B ${nonce}`, is_covered_entity: false, baa_status: 'not_required' },
      ])
      .select('id')
    expect(orgError).toBeNull()
    expect(orgs).toHaveLength(2)

    const orgA = orgs![0]!.id
    const orgB = orgs![1]!.id
    const { error: practitionerSeedError } = await admin
      .from('practitioners')
      .upsert([
        { id: a.user.id, organization_id: orgA, non_diagnostic_ack_at: new Date().toISOString() },
        { id: b.user.id, organization_id: orgB, non_diagnostic_ack_at: new Date().toISOString() },
      ])
    expect(practitionerSeedError).toBeNull()

    const { data: seededClients, error: clientSeedError } = await admin
      .from('clients')
      .insert([
        { practitioner_id: a.user.id, first_name: 'Alpha', last_name: 'Tenant' },
        { practitioner_id: b.user.id, first_name: 'Beta', last_name: 'Tenant' },
      ])
      .select('id, practitioner_id')
    expect(clientSeedError).toBeNull()
    expect(seededClients).toHaveLength(2)

    // Two real AAL2 users in two real organizations can see only their own rows.
    const { data: aClients, error: aReadError } = await a.client
      .from('clients')
      .select('id, practitioner_id')
    expect(aReadError).toBeNull()
    expect(aClients?.map((row) => row.practitioner_id)).toEqual([a.user.id])
    const { data: bClients, error: bReadError } = await b.client
      .from('clients')
      .select('id, practitioner_id')
    expect(bReadError).toBeNull()
    expect(bClients?.map((row) => row.practitioner_id)).toEqual([b.user.id])
    const { data: aOrgs } = await a.client.from('organizations').select('id')
    const { data: bOrgs } = await b.client.from('organizations').select('id')
    expect(aOrgs?.map((row) => row.id)).toEqual([orgA])
    expect(bOrgs?.map((row) => row.id)).toEqual([orgB])

    // Auth metadata is not authorization, and protected DB role columns cannot
    // be escalated through the browser client.
    expect((await a.client.auth.updateUser({ data: { role: 'admin' } })).error).toBeNull()
    const { error: roleEscalationError } = await a.client
      .from('practitioners')
      .update({ role: 'admin' })
      .eq('id', a.user.id)
    expect(roleEscalationError).toBeTruthy()
    expect((await a.client.from('clients').select('id')).data).toHaveLength(1)

    // A fresh password session for an otherwise active account is only AAL1;
    // restrictive policies make sensitive SELECTs empty rather than trusting it.
    const aAal1 = browserClient(url, anonKey)
    expect((await aAal1.auth.signInWithPassword({ email: emailA, password: PASSWORD })).error).toBeNull()
    const { data: assurance } = await aAal1.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(assurance?.currentLevel).toBe('aal1')
    const { data: aal1Clients, error: aal1ReadError } = await aAal1.from('clients').select('id')
    expect(aal1ReadError).toBeNull()
    expect(aal1Clients).toEqual([])
    const { error: aal1FactorEnrollmentError } = await aAal1.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `aal1-password-attacker-${nonce}`,
    })
    expect(aal1FactorEnrollmentError).toBeTruthy()

    const { data: oldBSession } = await b.client.auth.getSession()
    const oldBAccessToken = oldBSession.session?.access_token
    const oldBRefreshToken = oldBSession.session?.refresh_token
    expect(oldBAccessToken).toBeTruthy()
    expect(oldBRefreshToken).toBeTruthy()

    // Recovery atomically blocks PostgREST and deletes every GoTrue session.
    // An unexpired old JWT therefore cannot refresh, manage the user, or enroll
    // an attacker factor through the provider API while factors are removed.
    // Exercise the opposite email/recovery lock ordering from the invite-UI test.
    // Recovery acquires a share lock on auth.users, then waits on the practitioner
    // row. A later email update must wait and then fail once recovery_pending is
    // committed, keeping the provider delivery address stable.
    const recoveryBlocker = new pg.Client({ connectionString: dbUrl })
    const concurrentEmailChange = new pg.Client({ connectionString: dbUrl })
    await recoveryBlocker.connect()
    await concurrentEmailChange.connect()
    let recoveryPreparation: unknown = null
    let recoveryStartError: unknown = null
    try {
      await recoveryBlocker.query('BEGIN')
      await recoveryBlocker.query(
        `SELECT id FROM public.practitioners WHERE id = $1 FOR UPDATE`,
        [b.user.id],
      )
      let recoverySettled = false
      const recoveryPromise = admin.rpc('begin_practitioner_mfa_recovery_by_bound_email', {
        p_email: emailB,
        p_reason: 'e2e lost factor',
        p_actor: 'local-e2e-auth-boundary',
      }).then(
        (result) => {
          recoverySettled = true
          return result
        },
        (error: unknown) => {
          recoverySettled = true
          throw error
        },
      )
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(recoverySettled).toBe(false)

      let emailChangeSettled = false
      const emailChangePromise = concurrentEmailChange.query(
        `UPDATE auth.users
            SET email = $1, updated_at = clock_timestamp()
          WHERE id = $2`,
        [`recovery-race+${nonce}@postureai.test`, b.user.id],
      ).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      ).finally(() => {
        emailChangeSettled = true
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(emailChangeSettled).toBe(false)

      await recoveryBlocker.query('COMMIT')
      const recoveryResult = await recoveryPromise
      recoveryPreparation = recoveryResult.data
      recoveryStartError = recoveryResult.error
      const emailChangeResult = await emailChangePromise
      expect(String(emailChangeResult.error)).toContain(
        'practitioner email cannot change during MFA recovery',
      )
    } finally {
      await recoveryBlocker.query('ROLLBACK').catch(() => undefined)
      await recoveryBlocker.end()
      await concurrentEmailChange.end()
    }
    expect(recoveryStartError).toBeNull()
    expect(recoveryPreparation).toMatchObject({ user_id: b.user.id, target_email: emailB })
    expect((await b.client.from('clients').select('id')).data).toEqual([])

    const oldUserResponse = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${oldBAccessToken}` },
    })
    expect(oldUserResponse.status).toBeGreaterThanOrEqual(400)
    const attackerEnrollResponse = await fetch(`${url}/auth/v1/factors`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${oldBAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ factor_type: 'totp', friendly_name: `attacker-${nonce}` }),
    })
    expect(attackerEnrollResponse.status).toBeGreaterThanOrEqual(400)
    expect(attackerEnrollResponse.status).not.toBe(422)
    const staleRefreshClient = browserClient(url, anonKey)
    expect((await staleRefreshClient.auth.refreshSession({
      refresh_token: oldBRefreshToken!,
    })).error).toBeTruthy()

    const { data: bFactors, error: factorListError } = await admin.auth.admin.mfa.listFactors({
      userId: b.user.id,
    })
    expect(factorListError).toBeNull()
    for (const factor of bFactors?.factors ?? []) {
      expect((await admin.auth.admin.mfa.deleteFactor({ userId: b.user.id, id: factor.id })).error).toBeNull()
    }
    expect((await admin.rpc('finalize_practitioner_mfa_recovery', {
      p_user_id: b.user.id,
      p_actor: 'local-e2e-auth-boundary',
    })).error).toBeNull()
    // Recovery boundaries use whole JWT seconds; cross the next second before
    // minting the required email OTP + replacement TOTP session.
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const recoveredB = browserClient(url, anonKey)
    const { data: recoveryLink, error: recoveryLinkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: emailB,
    })
    expect(recoveryLinkError).toBeNull()
    expect(recoveryLink.properties?.hashed_token).toBeTruthy()
    expect((await recoveredB.auth.verifyOtp({
      type: 'recovery',
      token_hash: recoveryLink.properties!.hashed_token,
    })).error).toBeNull()
    expect((await recoveredB.auth.updateUser({ password: RECOVERED_PASSWORD })).error).toBeNull()
    const firstRecoveryFactorId = await enrollAndVerifyTotp(
      recoveredB,
      'Posture AI recovery E2E primary',
    )

    const boundaryConnection = new pg.Client({ connectionString: dbUrl })
    await boundaryConnection.connect()
    let recoveryBoundary: string
    try {
      const result = await boundaryConnection.query<{ session_valid_after: string }>(
        `SELECT session_valid_after::text FROM public.practitioners WHERE id = $1`,
        [b.user.id],
      )
      recoveryBoundary = result.rows[0]!.session_valid_after
    } finally {
      await boundaryConnection.end()
    }
    const readySecond = Math.floor(Date.parse(recoveryBoundary) / 1000)
    const freshSecond = readySecond + 2

    // The database transition itself rejects every incomplete recovery proof,
    // even if a caller bypasses the web route and submits a crafted AAL2 JWT.
    await expectRecoveryTransitionDenied({
      dbUrl,
      userId: b.user.id,
      email: emailB,
      issuedAt: freshSecond,
      amr: [
        { method: 'otp', timestamp: readySecond - 1 },
        { method: 'totp', timestamp: freshSecond },
      ],
      message: 'MFA recovery requires fresh email and authenticator verification',
    })
    await expectRecoveryTransitionDenied({
      dbUrl,
      userId: b.user.id,
      email: emailB,
      issuedAt: freshSecond,
      amr: [{ method: 'otp', timestamp: freshSecond }],
      message: 'MFA recovery requires fresh email and authenticator verification',
    })

    const secondRecoveryFactorId = await enrollAndVerifyTotp(
      recoveredB,
      'Posture AI recovery E2E duplicate',
    )
    const staleFactorConnection = new pg.Client({ connectionString: dbUrl })
    await staleFactorConnection.connect()
    try {
      await staleFactorConnection.query(
        `UPDATE auth.mfa_factors
            SET created_at = $1::timestamptz - interval '1 second',
                last_challenged_at = $1::timestamptz - interval '1 second'
          WHERE id = $2 AND user_id = $3`,
        [recoveryBoundary, secondRecoveryFactorId, b.user.id],
      )
    } finally {
      await staleFactorConnection.end()
    }
    await expectRecoveryTransitionDenied({
      dbUrl,
      userId: b.user.id,
      email: emailB,
      issuedAt: freshSecond,
      amr: [
        { method: 'otp', timestamp: freshSecond },
        { method: 'totp', timestamp: freshSecond },
      ],
      message: 'MFA recovery requires exactly one fresh verified factor',
    })

    const refreshFactorConnection = new pg.Client({ connectionString: dbUrl })
    await refreshFactorConnection.connect()
    try {
      await refreshFactorConnection.query(
        `UPDATE auth.mfa_factors
            SET created_at = clock_timestamp(), last_challenged_at = clock_timestamp()
          WHERE id = $1 AND user_id = $2`,
        [secondRecoveryFactorId, b.user.id],
      )
    } finally {
      await refreshFactorConnection.end()
    }
    await expectRecoveryTransitionDenied({
      dbUrl,
      userId: b.user.id,
      email: emailB,
      issuedAt: freshSecond,
      amr: [
        { method: 'otp', timestamp: freshSecond },
        { method: 'totp', timestamp: freshSecond },
      ],
      message: 'MFA recovery requires exactly one fresh verified factor',
    })
    expect((await admin.auth.admin.mfa.deleteFactor({
      userId: b.user.id,
      id: secondRecoveryFactorId,
    })).error).toBeNull()
    expect(firstRecoveryFactorId).toBeTruthy()
    const { data: recoveryCompletion, error: recoveryCompletionError } = await recoveredB.rpc(
      'complete_practitioner_invitation',
    )
    expect(recoveryCompletionError).toBeNull()
    expect(recoveryCompletion).toBe('activated')
    const { data: recoveredClients } = await recoveredB.from('clients').select('practitioner_id')
    expect(recoveredClients?.map((row) => row.practitioner_id)).toEqual([b.user.id])

    const staleB = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${oldBAccessToken}` } },
    })
    expect((await staleB.from('clients').select('id')).data).toEqual([])
    const staleEnrollAfterActivation = await fetch(`${url}/auth/v1/factors`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${oldBAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ factor_type: 'totp', friendly_name: `attacker-late-${nonce}` }),
    })
    expect(staleEnrollAfterActivation.status).toBeGreaterThanOrEqual(400)

    // Database revocation is first and authoritative: A's already-issued AAL2
    // JWT immediately loses every sensitive row, before any provider ban.
    // Convert A into the shape of a pre-migration, manually approved account so
    // this race also proves the immutable legacy identity binding is honored.
    const legacyBinding = new pg.Client({ connectionString: dbUrl })
    await legacyBinding.connect()
    try {
      await legacyBinding.query('BEGIN')
      const invitation = await legacyBinding.query<{ invitation_id: string }>(
        `SELECT invitation_id FROM public.practitioners WHERE id = $1 FOR UPDATE`,
        [a.user.id],
      )
      const invitationId = invitation.rows[0]!.invitation_id
      await legacyBinding.query(
        `UPDATE public.practitioners SET invitation_id = NULL WHERE id = $1`,
        [a.user.id],
      )
      await legacyBinding.query(
        `UPDATE private.practitioner_invitations
            SET state = 'expired', expired_at = clock_timestamp(),
                provisioned_user_id = NULL, updated_at = clock_timestamp()
          WHERE id = $1`,
        [invitationId],
      )
      await legacyBinding.query(
        `INSERT INTO private.practitioner_identity_bindings (
           practitioner_id, email_normalized, bound_by
         ) VALUES ($1, $2, 'local-e2e-legacy-binding')`,
        [a.user.id, emailA],
      )
      await legacyBinding.query('COMMIT')
    } finally {
      await legacyBinding.query('ROLLBACK').catch(() => undefined)
      await legacyBinding.end()
    }
    const changedEmailA = `practitioner-a-changed+${nonce}@postureai.test`
    const emailChange = new pg.Client({ connectionString: dbUrl })
    await emailChange.connect()
    let revokeResult: { data: unknown; error: unknown } | null = null
    try {
      await emailChange.query('BEGIN')
      await emailChange.query(
        `UPDATE auth.users SET email = $1, updated_at = clock_timestamp() WHERE id = $2`,
        [changedEmailA, a.user.id],
      )
      const revokePromise = admin.rpc('revoke_practitioner_access_by_bound_email', {
        p_email: emailA,
        p_reason: 'e2e access revocation',
        p_actor: 'local-e2e-auth-boundary',
      })
      const raced = await Promise.race([
        revokePromise.then((value) => ({ kind: 'completed' as const, value })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'timeout' }), 3_000)
        }),
      ])
      if (raced.kind === 'timeout') {
        await emailChange.query('ROLLBACK')
        await revokePromise
        throw new Error('revocation waited on the mutable Auth email row')
      }
      revokeResult = raced.value
      await emailChange.query('COMMIT')
    } finally {
      await emailChange.query('ROLLBACK').catch(() => undefined)
      await emailChange.end()
    }
    const { data: revokedId, error: revokeError } = revokeResult!
    expect(revokeError).toBeNull()
    expect(revokedId).toBe(a.user.id)
    const { data: revokedClients, error: revokedReadError } = await a.client
      .from('clients')
      .select('id')
    expect(revokedReadError).toBeNull()
    expect(revokedClients).toEqual([])
  })

  test('reissues an expired provisioned invitation to the same bound user', async () => {
    test.setTimeout(60_000)
    const { url, anonKey, serviceKey } = localConfig()
    const dbUrl = process.env.E2E_SUPABASE_DB_URL
    if (!dbUrl) throw new Error('E2E_SUPABASE_DB_URL is required')
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const email = `expired-reissue+${Date.now()}-${process.pid}@postureai.test`
    const user = await provisionLocalInvitedPractitioner({
      admin,
      supabaseUrl: url,
      email,
      password: PASSWORD,
      displayName: 'Expired Invite Practitioner',
    })
    const pool = new pg.Pool({ connectionString: dbUrl })
    try {
      await pool.query(
        `UPDATE private.practitioner_invitations
            SET expires_at = clock_timestamp()
          WHERE provisioned_user_id = $1 AND state = 'provisioned'`,
        [user.id],
      )

      const { data: reissue, error: reissueError } = await admin.rpc(
        'issue_practitioner_invitation_with_state',
        {
          p_email: email,
          p_display_name: 'Expired Invite Practitioner',
          p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          p_actor: 'local-e2e-expired-reissue',
        },
      )
      expect(reissueError).toBeNull()
      expect(reissue).toMatchObject({
        created: true,
        delivery: 'recovery',
        target_email: email,
        rollback_on_failure: false,
      })

      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
      })
      expect(linkError).toBeNull()
      const client = browserClient(url, anonKey)
      expect((await client.auth.verifyOtp({
        type: 'recovery',
        token_hash: link.properties!.hashed_token,
      })).error).toBeNull()
      expect((await client.auth.updateUser({ password: REISSUED_PASSWORD })).error).toBeNull()
      await activateLocalPractitionerAal2(client)

      const { data: practitioner } = await admin
        .from('practitioners')
        .select('access_status, invitation_id')
        .eq('id', user.id)
        .single()
      expect(practitioner?.access_status).toBe('active')
      expect(practitioner?.invitation_id).toBe(reissue.invitation_id)
    } finally {
      await pool.end()
    }
  })
})
