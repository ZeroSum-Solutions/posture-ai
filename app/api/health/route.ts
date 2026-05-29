import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { error } = await supabase.from('practitioners').select('count').limit(1)
    if (error && error.code !== '42P01' && error.code !== 'PGRST116') {
      throw new Error(error.message)
    }
    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      database: 'disconnected',
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
