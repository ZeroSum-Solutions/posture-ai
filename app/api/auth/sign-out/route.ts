import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  await supabase.auth.signOut()
  const origin = new URL(request.url).origin
  return NextResponse.redirect(`${origin}/auth/sign-in`, { status: 302 })
}
