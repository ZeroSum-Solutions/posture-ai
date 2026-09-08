import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

function redirectWithCookies(location: string, cookiesToSet: readonly CookieToSet[]): NextResponse {
  // Keep the redirect relative so the browser stays on the exact host that
  // received the invite request (localhost and 127.0.0.1 do not share cookies).
  // This also avoids constructing an absolute redirect from forwarded headers.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: location },
  })
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options)
  }
  return response
}

/**
 * Dedicated email-token handler. Invitation and password-recovery emails use
 * token hashes so they do not depend on a browser-local PKCE verifier.
 */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const requestedType = request.nextUrl.searchParams.get('type')
  const type = requestedType === 'recovery' ? 'recovery' : 'invite'
  const failureReason = type === 'recovery' ? 'recovery_invalid' : 'invite_invalid'
  const cookiesToSet: CookieToSet[] = []

  if (!tokenHash) {
    return redirectWithCookies(`/auth/sign-in?reason=${failureReason}`, [])
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(updated: CookieToSet[]) {
          for (const cookie of updated) {
            const existing = cookiesToSet.findIndex(({ name }) => name === cookie.name)
            if (existing === -1) cookiesToSet.push(cookie)
            else cookiesToSet[existing] = cookie
          }
        },
      },
    },
  )

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  })

  if (error) {
    return redirectWithCookies(
      `/auth/sign-in?reason=${failureReason}`,
      cookiesToSet,
    )
  }

  if (type === 'invite') {
    const { data: actor, error: actorError } = await supabase
      .rpc('current_application_actor')
      .maybeSingle()
    const actorKind = (actor as { actor_kind?: unknown } | null)?.actor_kind
    if (actorError || (actorKind !== 'athlete' && actorKind !== 'practitioner')) {
      return redirectWithCookies('/auth/sign-in?reason=invite_invalid', cookiesToSet)
    }
    if (actorKind === 'athlete') {
      return redirectWithCookies('/train/accept-invite', cookiesToSet)
    }
  }

  return redirectWithCookies(
    type === 'recovery' ? '/auth/update-password' : '/auth/accept-invite',
    cookiesToSet,
  )
}
