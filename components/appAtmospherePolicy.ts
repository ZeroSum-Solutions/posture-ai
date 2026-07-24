const ATMOSPHERE_EXCLUDED_PREFIXES = [
  '/auth',
  '/onboarding',
  '/assessments',
  '/clients',
  '/workouts',
] as const

export function shouldRenderAppAtmosphere(pathname: string): boolean {
  if (pathname === '/') return false
  return !ATMOSPHERE_EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
