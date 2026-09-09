import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { totpCode } from '../../scripts/testing/totp'

/** Fresh local fixture through the real invitation and AAL2 activation path. */
export async function provisionLocalAthlete() {
  const url = process.env.E2E_SUPABASE_URL
  const anon = process.env.E2E_SUPABASE_ANON_KEY
  const service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('Athlete fixture requires explicit local Supabase')
  }
  const email = `athlete-${randomUUID()}@fixtures.invalid`
  const password = `Local-only-${randomUUID()}!`
  const options = { auth: { autoRefreshToken: false, persistSession: false } }
  const admin = createClient(url, service, options)
  const { error: invitationError } = await admin.rpc('issue_self_directed_athlete_invitation', {
    p_email: email, p_display_name: 'Local Athlete',
    p_expires_at: new Date(Date.now() + 3_600_000).toISOString(), p_actor: 'local-athlete-e2e',
  })
  if (invitationError) throw new Error(`Athlete invitation failed: ${invitationError.code}`)
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (createError || !created.user) throw new Error(`Athlete fixture provisioning failed: ${createError?.code}`)
  const client = createClient(url, anon, options)
  const { error: loginError } = await client.auth.signInWithPassword({ email, password })
  if (loginError) throw new Error(`Athlete fixture login failed: ${loginError.code}`)
  const { data: factor, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Local athlete test' })
  if (enrollError || !factor) throw new Error('Athlete fixture MFA enrollment failed')
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id })
  if (challengeError || !challenge) throw new Error('Athlete fixture MFA challenge failed')
  const { error: verifyError } = await client.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: totpCode(factor.totp.secret) })
  if (verifyError) throw new Error('Athlete fixture MFA verification failed')
  const { data: activation, error: activationError } = await client.rpc('complete_athlete_invitation')
  if (activationError || !['activated', 'already_active'].includes(String(activation))) throw new Error('Athlete fixture activation failed')
  const { data: actor, error: actorError } = await client.rpc('current_application_actor').single()
  const parsedActor = z.object({ actor_kind: z.literal('athlete'), subject_id: z.string().uuid() }).safeParse(actor)
  if (actorError || !parsedActor.success) throw new Error('Athlete fixture identity did not resolve')
  await client.auth.signOut({ scope: 'local' })
  return { email, password, secret: factor.totp.secret, subjectId: parsedActor.data.subject_id }
}
