/**
 * The proxy (middleware) auth-gate allowlist, extracted pure so the boundary is
 * unit-testable (see public-paths.test.ts): a typo here either exposes every
 * gated page or breaks the public share/consent links.
 */
export function publicPaths(nodeEnv: string | undefined = process.env.NODE_ENV): string[] {
  return [
    '/',
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/callback',
    // Password reset must be reachable while signed out. /auth/update-password
    // self-guards on the recovery session (and renders its own expired-link
    // state), so it is public rather than gated behind auth + onboarding.
    '/auth/forgot-password',
    '/auth/update-password',
    '/api/health',
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

export function isPublicPath(pathname: string, paths: readonly string[] = PUBLIC_PATHS): boolean {
  return paths.some((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)))
}
