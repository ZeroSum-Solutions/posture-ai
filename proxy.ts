import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
// The allowlist + matcher live in lib/auth/public-paths.ts so the auth boundary
// is unit-tested (public-paths.test.ts) — edit the list THERE.
import { isPublicPath } from '@/lib/auth/public-paths'

// Routes that require auth but not disclaimer acknowledgement
const ONBOARDING_PATHS = ['/onboarding']

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabaseResponse.cookies.set(name, value, options as any)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Allow public paths
  if (isPublicPath(pathname)) return supabaseResponse

  // Redirect unauthenticated users to sign-in
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/sign-in'
    return NextResponse.redirect(url)
  }

  // Allow onboarding path (so user can acknowledge disclaimer)
  const isOnboarding = ONBOARDING_PATHS.some(p => pathname.startsWith(p))
  if (isOnboarding) return supabaseResponse

  // Check disclaimer acknowledgement for all other protected routes
  const { data: practitioner } = await supabase
    .from('practitioners')
    .select('non_diagnostic_ack_at')
    .eq('id', user.id)
    .single()

  if (!practitioner?.non_diagnostic_ack_at) {
    const url = request.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
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
