import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const SUCCESS_RESULTS = new Set(['activated', 'already_active'])
const FORBIDDEN_RESULTS = new Set([
  'revoked',
  'not_invited',
  'email_mismatch',
  'mfa_required',
  'recovery_not_authorized',
])

/**
 * Completes admission only after the request has an authenticated AAL2 session.
 * The no-argument database RPC independently derives auth.uid(), JWT email and
 * AAL, then consumes/activates the matching invitation atomically.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json(
      { error: 'Your invitation session has expired.', code: 'unauthorized' },
      { status: 401 },
    )
  }

  if (!user.email) {
    return NextResponse.json(
      { error: 'The invitation email could not be verified.', code: 'email_mismatch' },
      { status: 403 },
    )
  }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError || assurance?.currentLevel !== 'aal2') {
    return NextResponse.json(
      { error: 'Complete multi-factor authentication before activating access.', code: 'mfa_required' },
      { status: 403 },
    )
  }

  // Deliberately pass no identity arguments. The SECURITY DEFINER RPC reads the
  // authenticated JWT itself so a caller cannot bind another user or email.
  const { data, error } = await supabase.rpc('complete_practitioner_invitation')
  if (error || typeof data !== 'string') {
    return NextResponse.json(
      { error: 'Could not complete the invitation. Please try again.', code: 'completion_failed' },
      { status: 500 },
    )
  }

  if (SUCCESS_RESULTS.has(data)) {
    return NextResponse.json({ ok: true, status: data })
  }

  if (data === 'expired') {
    return NextResponse.json(
      { error: 'This invitation has expired. Request a replacement invitation.', code: data },
      { status: 410 },
    )
  }

  if (FORBIDDEN_RESULTS.has(data)) {
    return NextResponse.json(
      { error: invitationErrorMessage(data), code: data },
      { status: 403 },
    )
  }

  return NextResponse.json(
    { error: 'Could not complete the invitation. Please try again.', code: 'completion_failed' },
    { status: 500 },
  )
}

function invitationErrorMessage(code: string): string {
  switch (code) {
    case 'revoked':
      return 'Practitioner access has been revoked. Contact your beta administrator.'
    case 'not_invited':
    case 'email_mismatch':
      return 'This account does not match an active practitioner invitation.'
    case 'mfa_required':
      return 'Complete multi-factor authentication before activating access.'
    case 'recovery_not_authorized':
      return 'MFA recovery has not been authorized. Contact your beta administrator.'
    default:
      return 'Could not complete the invitation.'
  }
}
