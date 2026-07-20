import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  // Browsers set Sec-Fetch-Site and do not let page JavaScript forge it. Reject a
  // cross-site form/fetch before touching the session; clients without Fetch
  // Metadata remain compatible because forced logout is the only CSRF impact.
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json(
      { error: 'Cross-site sign out is not allowed.', code: 'cross_site_request' },
      { status: 403 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    return NextResponse.json(
      { error: 'Could not end the session.', code: 'signout_failed' },
      { status: 503 },
    )
  }
  // A relative Location preserves the exact cookie host and never trusts Host or
  // forwarded-host input to construct a redirect destination.
  return new NextResponse(null, {
    status: 302,
    headers: { Location: '/auth/sign-in' },
  })
}
