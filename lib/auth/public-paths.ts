/**
 * The proxy (middleware) auth-gate allowlist, extracted pure so the boundary is
 * unit-testable (see public-paths.test.ts): a typo here either exposes every
 * gated page or breaks the public share/consent links.
 */
export type AuthPathClass = 'public' | 'aal1-corridor' | 'protected'

export function publicPaths(nodeEnv: string | undefined = process.env.NODE_ENV): string[] {
  return [
    '/',
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/callback',
    // Supabase invitation links are token-hash OTP links, not PKCE callbacks.
    // This route verifies the one-time token and establishes the initial AAL1
    // session before handing off to the authenticated invitation corridor.
    '/auth/confirm',
    // Password reset must be reachable while signed out. /auth/update-password
    // self-guards on the recovery session (and renders its own expired-link
    // state), so it is public rather than gated behind auth + onboarding.
    '/auth/forgot-password',
    '/auth/update-password',
    '/api/health',
    // Vercel cron has no practitioner session. This exact machine route performs
    // its own timing-safe CRON_SECRET authentication before any mutation.
    '/api/internal/privacy-maintenance',
    // The legal-document catalog is public so signed-out onboarding and remote
    // subject-consent surfaces can render the exact governed snapshot.
    '/api/legal/documents',
    // Public legal pages + the remote subject-consent flow (the subject is not an
    // authenticated user). The remote consent API self-authenticates via a signed,
    // single-use token, so its public endpoint is allow-listed here too.
    '/privacy',
    '/terms',
    '/consent',
    '/api/consent/respond',
    // Public workout follow-along: the client is NOT an authenticated user. Both the
    // landing page and its hydrate/rate API self-authenticate via the hashed share
    // token through resolve_workout_token() (all gates + redaction enforced there),
    // so they are allow-listed like the remote-consent flow above.
    '/s/',
    '/api/workouts/token/',
    // Dev-only routes are never public in production builds (each also self-guards).
    ...(nodeEnv !== 'production' ? ['/api/dev/'] : []),
  ]
}

export const PUBLIC_PATHS = publicPaths()

/**
 * Authenticated setup/recovery routes which must remain reachable before a
 * practitioner has AAL2 + active admission. Each route performs its own narrow
 * operation; this is not a general authenticated allowlist.
 */
export const AAL1_CORRIDOR_PATHS = [
  '/auth/accept-invite',
  '/auth/mfa',
  '/api/auth/complete-invitation',
  '/api/auth/sign-out',
] as const

function matchesPath(pathname: string, configuredPath: string): boolean {
  if (configuredPath === '/') return pathname === '/'
  // A trailing slash deliberately denotes a path family such as /s/<token>.
  if (configuredPath.endsWith('/')) return pathname.startsWith(configuredPath)
  // Everything else is exact or segment-anchored. This prevents a public path
  // such as /auth/sign-in from shadowing /auth/sign-in-admin.
  return pathname === configuredPath || pathname.startsWith(`${configuredPath}/`)
}

export function isPublicPath(pathname: string, paths: readonly string[] = PUBLIC_PATHS): boolean {
  return paths.some((p) => matchesPath(pathname, p))
}

export function isAal1CorridorPath(
  pathname: string,
  paths: readonly string[] = AAL1_CORRIDOR_PATHS,
): boolean {
  return paths.some((p) => matchesPath(pathname, p))
}

export function classifyAuthPath(
  pathname: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): AuthPathClass {
  if (isPublicPath(pathname, publicPaths(nodeEnv))) return 'public'
  if (isAal1CorridorPath(pathname)) return 'aal1-corridor'
  return 'protected'
}
