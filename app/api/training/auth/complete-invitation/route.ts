import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const SUCCESS_RESULTS = new Set(['activated', 'already_active'])
const FORBIDDEN_RESULTS = new Set([
  'revoked',
  'not_invited',
  'email_mismatch',
  'mfa_required',
  'ambiguous_actor',
])

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json(
      { error: 'Your invitation session has expired.', code: 'unauthorized' },
      { status: 401 },
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

  const { data, error } = await supabase.rpc('complete_athlete_invitation')
  if (error || typeof data !== 'string') {
    return NextResponse.json(
      { error: 'Could not complete the athlete invitation. Please try again.', code: 'completion_failed' },
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
      { error: athleteInvitationError(data), code: data },
      { status: 403 },
    )
  }
  return NextResponse.json(
    { error: 'Could not complete the athlete invitation. Please try again.', code: 'completion_failed' },
    { status: 500 },
  )
}

function athleteInvitationError(code: string): string {
  switch (code) {
    case 'revoked':
      return 'Athlete access has been revoked.'
    case 'ambiguous_actor':
      return 'This account has conflicting application roles. Contact support.'
    case 'mfa_required':
      return 'Complete multi-factor authentication before activating access.'
    default:
      return 'This account does not match an active athlete invitation.'
  }
}
