const OPERATIONAL_ROUTE_PREFIXES = [
  '/assessments',
  '/clients',
] as const

export function isOperationalRoute(pathname: string): boolean {
  return OPERATIONAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Operational screens must present their first usable state without a
 * route-level entrance animation. The performance harness begins interacting
 * after hydration; a decorative transform still in flight at that boundary
 * delays the next presented frame and is charged to INP.
 */
export function shouldAnimateRouteEntrance(pathname: string): boolean {
  return !isOperationalRoute(pathname)
}
