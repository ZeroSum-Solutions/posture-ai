import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that don't require auth
const PUBLIC_PATHS = [
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/callback',
  '/api/health',
  '/api/dev/',
  '/api/clients',
]

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
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))
  if (isPublic) return supabaseResponse

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
