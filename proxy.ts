import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { classifyAuthPath } from '@/lib/auth/public-paths'
import { practitionerLegalAcceptanceStatus } from '@/lib/auth/requirePractitioner'

type CookieToSet = {
  name: string
  value: string
  options?: Record<string, unknown>
}

type PractitionerAccessState = {
  access_status: string
  role: string
  session_is_current: boolean
}

const isOnboardingPath = (pathname: string) =>
  pathname === '/onboarding' || pathname.startsWith('/onboarding/')

const isLegalAcceptanceCorridor = (pathname: string) =>
  isOnboardingPath(pathname) || pathname === '/api/legal/accept'

const isApiPath = (pathname: string) =>
  pathname === '/api' || pathname.startsWith('/api/')

function requestedPath(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`
}

function applyAuthCookies(response: NextResponse, cookiesToSet: readonly CookieToSet[]): NextResponse {
  for (const { name, value, options } of cookiesToSet) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response.cookies.set(name, value, options as any)
  }
  return response
}

function redirectWithAuthCookies(
  request: NextRequest,
  pathname: string,
  cookiesToSet: readonly CookieToSet[],
  search?: Record<string, string>,
): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value)
  }
  return applyAuthCookies(NextResponse.redirect(url), cookiesToSet)
}

function jsonWithAuthCookies(
  body: Record<string, unknown>,
  status: number,
  cookiesToSet: readonly CookieToSet[],
): NextResponse {
  return applyAuthCookies(NextResponse.json(body, { status }), cookiesToSet)
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const refreshedCookies: CookieToSet[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const cookie of cookiesToSet) {
            const existing = refreshedCookies.findIndex(({ name }) => name === cookie.name)
            if (existing === -1) refreshedCookies.push(cookie)
            else refreshedCookies[existing] = cookie
            request.cookies.set(cookie.name, cookie.value)
          }
          // Recreate the pass-through response with the refreshed request cookies
          // and then mirror them to the browser response below.
          supabaseResponse = NextResponse.next({ request })
          applyAuthCookies(supabaseResponse, refreshedCookies)
        },
      },
    },
  )

  const pathname = request.nextUrl.pathname
  const pathClass = classifyAuthPath(pathname)
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  // Public token/legal/sign-in surfaces remain reachable even when no Auth
  // session exists. getUser still runs first so an expiring cookie can rotate.
  if (pathClass === 'public') return supabaseResponse

  if (userError || !user) {
    if (isApiPath(pathname)) {
      return jsonWithAuthCookies(
        { error: 'Unauthorized', code: 'unauthorized' },
        401,
        refreshedCookies,
      )
    }
    return redirectWithAuthCookies(
      request,
      '/auth/sign-in',
      refreshedCookies,
      { next: requestedPath(request) },
    )
  }

  // The narrow setup/recovery corridor is intentionally available to an
  // authenticated AAL1 user before a practitioner row is active. Its endpoints
  // independently bind invitations and verify AAL2 before activation.
  if (pathClass === 'aal1-corridor') return supabaseResponse

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError || assurance?.currentLevel !== 'aal2') {
    if (isApiPath(pathname)) {
      return jsonWithAuthCookies(
        { error: 'Multi-factor authentication is required.', code: 'mfa_required' },
        403,
        refreshedCookies,
      )
    }
    return redirectWithAuthCookies(
      request,
      '/auth/mfa',
      refreshedCookies,
      { next: requestedPath(request) },
    )
  }

  // The normal practitioners policy hides invited/recovery/revoked rows by
  // design. This no-argument definer RPC returns only auth.uid()'s own admission
  // state, so middleware can route those states without weakening table RLS.
  const { data: practitionerRow, error: practitionerError } = await supabase
    .rpc('current_practitioner_access_state')
    .maybeSingle()
  const practitioner = practitionerRow as PractitionerAccessState | null

  const admitted =
    !practitionerError &&
    practitioner?.access_status === 'active' &&
    practitioner?.role === 'practitioner' &&
    practitioner?.session_is_current === true

  if (!admitted) {
    const status = practitioner?.access_status
    const accessRevoked = status === 'revoked' || status === 'suspended'
    const mayCompleteAdmission = status === 'invited' || status === 'recovery_pending'
    const sessionStale = status === 'active' && practitioner?.session_is_current === false
    if (accessRevoked || (!practitionerError && !mayCompleteAdmission)) {
      // Clear this browser's cookie immediately. Database status remains the
      // authoritative revocation check because issued JWTs can outlive signout.
      await supabase.auth.signOut({ scope: 'local' })
    }

    if (isApiPath(pathname)) {
      return jsonWithAuthCookies(
        { error: 'Practitioner access required.', code: 'practitioner_access_required' },
        403,
        refreshedCookies,
      )
    }

    if (!practitionerError && mayCompleteAdmission) {
      // An AAL2 invite/recovery session may still need its atomic activation RPC.
      return redirectWithAuthCookies(
        request,
        '/auth/mfa',
        refreshedCookies,
        { next: requestedPath(request) },
      )
    }

    return redirectWithAuthCookies(
      request,
      '/auth/sign-in',
      refreshedCookies,
      {
        reason: accessRevoked
          ? 'access_revoked'
          : sessionStale
            ? 'session_stale'
          : status === 'review_required'
            ? 'access_review_required'
            : practitionerError
              ? 'access_unavailable'
              : 'access_denied',
      },
    )
  }

  // This is the only protected corridor before governed acceptance. The API
  // independently repeats admission and verifies the exact submitted snapshots.
  if (isLegalAcceptanceCorridor(pathname)) return supabaseResponse

  const legalStatus = await practitionerLegalAcceptanceStatus(supabase, user.id)
  if (legalStatus === 'unavailable') {
    if (isApiPath(pathname)) {
      return jsonWithAuthCookies(
        { error: 'Legal documents are temporarily unavailable.', code: 'legal_unavailable' },
        503,
        refreshedCookies,
      )
    }
    return redirectWithAuthCookies(
      request,
      '/onboarding',
      refreshedCookies,
      { reason: 'legal_unavailable' },
    )
  }

  if (legalStatus === 'required') {
    if (isApiPath(pathname)) {
      return jsonWithAuthCookies(
        { error: 'Legal acceptance required.', code: 'legal_acceptance_required' },
        403,
        refreshedCookies,
      )
    }
    return redirectWithAuthCookies(request, '/onboarding', refreshedCookies)
  }

  return supabaseResponse
}

export const config = {
  // `muscle-viewer` is the embedded 3D anatomy widget (public/muscle-viewer/**): generic,
  // non-sensitive static assets (CC-BY-SA anatomy + JS) that carry no patient data — the
  // assessment drives colors in at runtime via postMessage. Excluded from auth like _next/static
  // so its assets (incl. the ~9 MB GLB) serve statically without a Supabase round-trip each.
  matcher: [
    // `muscle-viewer(?:$|/)` is segment-anchored so only /muscle-viewer and /muscle-viewer/…
    // skip the middleware; a phantom path like /muscle-viewerX stays auth-gated.
    '/((?!_next/static|_next/image|muscle-viewer(?:$|/)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
