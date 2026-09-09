import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { classifyAuthPath } from '@/lib/auth/public-paths'
import { practitionerLegalAcceptanceStatus } from '@/lib/auth/requirePractitioner'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { buildApplicationCsp } from '@/lib/security/csp'
import { isPublicPoseAsset } from '@/lib/pose/public-assets'
import { configuredOperationMode, operationForPractitioner } from '@/lib/prototype/runtime'

type CookieToSet = {
  name: string
  value: string
  options?: Record<string, unknown>
}

type ApplicationActorState = {
  actor_kind: 'practitioner' | 'athlete' | 'ambiguous'
  subject_id: string | null
  access_status: string
  role: string | null
  session_is_current: boolean
  invitation_mode: 'self_directed' | 'coach_invited' | null
}

const isOnboardingPath = (pathname: string) =>
  pathname === '/onboarding' || pathname.startsWith('/onboarding/')

const isLegalAcceptanceCorridor = (pathname: string) =>
  isOnboardingPath(pathname) || pathname === '/api/legal/accept'

const isApiPath = (pathname: string) =>
  pathname === '/api' || pathname.startsWith('/api/')

const isAthletePath = (pathname: string) =>
  pathname === '/train' || pathname.startsWith('/train/') ||
  pathname === '/exercises' ||
  pathname === '/workouts/manual' || pathname.startsWith('/workouts/manual/') ||
  pathname === '/api/training' || pathname.startsWith('/api/training/')

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
  const pathname = request.nextUrl.pathname
  const isMuscleViewer = pathname === '/muscle-viewer' || pathname.startsWith('/muscle-viewer/')
  const nonce = crypto.randomUUID()
  const applicationCsp = isMuscleViewer
    ? null
    : buildApplicationCsp({
        nonce,
        nodeEnv: process.env.NODE_ENV,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      })
  const withApplicationCsp = (response: NextResponse): NextResponse => {
    if (applicationCsp) response.headers.set('Content-Security-Policy', applicationCsp)
    return response
  }
  const nextApplicationResponse = (): NextResponse => {
    const requestHeaders = new Headers(request.headers)
    if (applicationCsp) {
      requestHeaders.set('Content-Security-Policy', applicationCsp)
      requestHeaders.set('x-nonce', nonce)
    }
    return withApplicationCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  }
  let supabaseResponse = nextApplicationResponse()
  const refreshedCookies: CookieToSet[] = []

  // These exact immutable pose assets contain no account or scan data.
  if (isPublicPoseAsset(pathname)) return supabaseResponse

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
          supabaseResponse = nextApplicationResponse()
          applyAuthCookies(supabaseResponse, refreshedCookies)
        },
      },
    },
  )

  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  const prototypeDeployment = configuredOperationMode() === 'prototype'
  let needsPrototypeAssetAccess = false
  if (isMuscleViewer) {
    if (!clinicalAccess.surfaces.knowledgeLinks && !prototypeDeployment) {
      return withApplicationCsp(new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }))
    }
    needsPrototypeAssetAccess ||= !clinicalAccess.surfaces.knowledgeLinks
    // The anatomy viewer is practitioner-only. Continue through normal auth,
    // MFA, admission, and legal gates after both release authorities agree.
  }
  if (pathname.startsWith('/audio/workout-coach-river/')) {
    if (!clinicalAccess.surfaces.workouts && !prototypeDeployment) {
      return withApplicationCsp(new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }))
    }
    // Reviewed shared-session audio remains public. Prototype audio needs the
    // same authenticated operator admission as the original application.
    if (clinicalAccess.surfaces.workouts) return supabaseResponse
    needsPrototypeAssetAccess = true
  }
  if (pathname === '/demos' || pathname.startsWith('/demos/')) {
    if (!clinicalAccess.surfaces.recommendations && !prototypeDeployment) {
      return withApplicationCsp(new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }))
    }
    needsPrototypeAssetAccess ||= !clinicalAccess.surfaces.recommendations
    // Exercise demonstrations are practitioner-only until a future token-bound
    // media projection exists for public workout shares.
  }

  const pathClass = classifyAuthPath(pathname)
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  // Public token/legal/sign-in surfaces remain reachable even when no Auth
  // session exists. getUser still runs first so an expiring cookie can rotate.
  if (pathClass === 'public') return supabaseResponse

  if (userError || !user) {
    if (isApiPath(pathname)) {
      return withApplicationCsp(jsonWithAuthCookies(
        { error: 'Unauthorized', code: 'unauthorized' },
        401,
        refreshedCookies,
      ))
    }
    return withApplicationCsp(redirectWithAuthCookies(
      request,
      '/auth/sign-in',
      refreshedCookies,
      { next: requestedPath(request) },
    ))
  }

  // The narrow setup/recovery corridor is intentionally available to an
  // authenticated AAL1 user before a practitioner row is active. Its endpoints
  // independently bind invitations and verify AAL2 before activation.
  if (pathClass === 'aal1-corridor') return supabaseResponse

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError || assurance?.currentLevel !== 'aal2') {
    if (isApiPath(pathname)) {
      return withApplicationCsp(jsonWithAuthCookies(
        { error: 'Multi-factor authentication is required.', code: 'mfa_required' },
        403,
        refreshedCookies,
      ))
    }
    return withApplicationCsp(redirectWithAuthCookies(
      request,
      '/auth/mfa',
      refreshedCookies,
      { next: requestedPath(request) },
    ))
  }

  // The no-argument definer RPC derives the actor from auth.uid(). It returns an
  // explicit ambiguous state when one UID has both identity classes.
  const { data: actorRow, error: actorError } = await supabase
    .rpc('current_application_actor')
    .maybeSingle()
  const actor = actorRow as ApplicationActorState | null

  if (!actorError && actor?.actor_kind === 'athlete') {
    const accessRevoked = actor.access_status === 'revoked' || actor.access_status === 'suspended'
    const mayCompleteAdmission = actor.access_status === 'invited'
    const sessionStale = actor.access_status === 'active' && !actor.session_is_current
    const admitted = actor.access_status === 'active' && actor.session_is_current

    if (!admitted) {
      if (accessRevoked || sessionStale) await supabase.auth.signOut({ scope: 'local' })
      if (isApiPath(pathname)) {
        return withApplicationCsp(jsonWithAuthCookies(
          { error: 'Athlete access required.', code: 'athlete_access_required' },
          403,
          refreshedCookies,
        ))
      }
      if (mayCompleteAdmission) {
        return withApplicationCsp(redirectWithAuthCookies(
          request,
          '/auth/mfa',
          refreshedCookies,
          { mode: 'athlete-invite', next: '/train' },
        ))
      }
      return withApplicationCsp(redirectWithAuthCookies(
        request,
        '/auth/sign-in',
        refreshedCookies,
        { reason: accessRevoked ? 'access_revoked' : sessionStale ? 'session_stale' : 'access_denied' },
      ))
    }

    if (!isAthletePath(pathname)) {
      if (isApiPath(pathname)) {
        return withApplicationCsp(jsonWithAuthCookies(
          { error: 'This route is outside the athlete workspace.', code: 'athlete_scope_denied' },
          403,
          refreshedCookies,
        ))
      }
      return withApplicationCsp(redirectWithAuthCookies(
        request,
        '/train',
        refreshedCookies,
        { reason: 'scope_denied' },
      ))
    }
    return supabaseResponse
  }

  const practitioner = actor?.actor_kind === 'practitioner' ? actor : null

  const admitted =
    !actorError &&
    practitioner?.access_status === 'active' &&
    practitioner?.role === 'practitioner' &&
    practitioner?.session_is_current === true

  if (!admitted) {
    const status = practitioner?.access_status
    const accessRevoked = status === 'revoked' || status === 'suspended'
    const mayCompleteAdmission = status === 'invited' || status === 'recovery_pending'
    const sessionStale = status === 'active' && practitioner?.session_is_current === false
    if (accessRevoked || (!actorError && !mayCompleteAdmission)) {
      // Clear this browser's cookie immediately. Database status remains the
      // authoritative revocation check because issued JWTs can outlive signout.
      await supabase.auth.signOut({ scope: 'local' })
    }

    if (isApiPath(pathname)) {
      return withApplicationCsp(jsonWithAuthCookies(
        { error: 'Practitioner access required.', code: 'practitioner_access_required' },
        403,
        refreshedCookies,
      ))
    }

    if (!actorError && mayCompleteAdmission) {
      // An AAL2 invite/recovery session may still need its atomic activation RPC.
      return withApplicationCsp(redirectWithAuthCookies(
        request,
        '/auth/mfa',
        refreshedCookies,
        { next: requestedPath(request) },
      ))
    }

    return withApplicationCsp(redirectWithAuthCookies(
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
            : actorError
              ? 'access_unavailable'
              : 'access_denied',
      },
    ))
  }

  // Prototype operation is an explicit operator-scoped business policy. It is
  // considered only after authentication, MFA, admission and revocation checks.
  const prototypeOperator = operationForPractitioner(user.id).isPrototype
  if (needsPrototypeAssetAccess && !prototypeOperator) {
    return withApplicationCsp(new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } }))
  }
  if (prototypeOperator) {
    if (isOnboardingPath(pathname)) {
      return withApplicationCsp(redirectWithAuthCookies(request, '/dashboard', refreshedCookies))
    }
    return supabaseResponse
  }

  // This is the only protected corridor before governed acceptance. The API
  // independently repeats admission and verifies the exact submitted snapshots.
  if (isLegalAcceptanceCorridor(pathname)) return supabaseResponse

  const legalStatus = await practitionerLegalAcceptanceStatus(supabase, user.id)
  if (legalStatus === 'unavailable') {
    if (isApiPath(pathname)) {
      return withApplicationCsp(jsonWithAuthCookies(
        { error: 'Legal documents are temporarily unavailable.', code: 'legal_unavailable' },
        503,
        refreshedCookies,
      ))
    }
    return withApplicationCsp(redirectWithAuthCookies(
      request,
      '/onboarding',
      refreshedCookies,
      { reason: 'legal_unavailable' },
    ))
  }

  if (legalStatus === 'required') {
    if (isApiPath(pathname)) {
      return withApplicationCsp(jsonWithAuthCookies(
        { error: 'Legal acceptance required.', code: 'legal_acceptance_required' },
        403,
        refreshedCookies,
      ))
    }
    return withApplicationCsp(redirectWithAuthCookies(request, '/onboarding', refreshedCookies))
  }

  return supabaseResponse
}

export const config = {
  // Clinical static entry points deliberately pass through the gate above.
  // A phantom path such as /muscle-viewerX remains on the normal auth path.
  matcher: [
    // Explicit entries ensure clinical static files still run through the gate
    // even when their extension is excluded by the general application matcher.
    '/muscle-viewer/:path*',
    '/audio/workout-coach-river/:path*',
    '/demos/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
