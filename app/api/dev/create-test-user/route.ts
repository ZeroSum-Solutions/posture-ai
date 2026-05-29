import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Dev-only endpoint to create a confirmed test user
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  const supabase = createSupabaseServiceClient()
  const testEmail = 'testpractitioner@postureai.test'
  const testPassword = 'TestPass1234!'

  try {
    // Check if user already exists
    const { data: usersData } = await supabase.auth.admin.listUsers()
    const existingUser = usersData?.users?.find((u: { email?: string }) => u.email === testEmail)

    if (existingUser) {
      // Check practitioners row
      const { data: prac } = await supabase
        .from('practitioners')
        .select('id, non_diagnostic_ack_at')
        .eq('id', existingUser.id)
        .single()
      return NextResponse.json({
        message: 'User already exists',
        userId: existingUser.id,
        email: testEmail,
        practitionersRow: prac,
      })
    }

    // Create confirmed user
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Wait briefly for trigger
    await new Promise(r => setTimeout(r, 800))

    // Check practitioners row was auto-created by trigger
    const { data: prac } = await supabase
      .from('practitioners')
      .select('id, non_diagnostic_ack_at')
      .eq('id', data.user.id)
      .single()

    return NextResponse.json({
      message: 'Test user created with email_confirm=true',
      userId: data.user.id,
      email: testEmail,
      practitionersRow: prac,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
