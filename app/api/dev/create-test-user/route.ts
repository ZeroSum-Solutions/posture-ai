import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { isLegalFixtureMode, resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalDocumentKind } from '@/lib/legal/types'
import { NextResponse } from 'next/server'

const PRACTITIONER_DOCUMENT_KINDS = [
  'terms',
  'privacy',
  'screening_notice',
] as const satisfies readonly LegalDocumentKind[]

async function seedFixtureLegalAcceptances(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  practitionerId: string,
) {
  if (!isLegalFixtureMode()) return
  const acceptedAt = new Date().toISOString()
  const rows = PRACTITIONER_DOCUMENT_KINDS.map((kind) => {
    const resolution = resolveRuntimeLegalDocument({ kind })
    if (!resolution.ok) throw new Error(`Fixture legal document unavailable: ${kind}`)
    const document = snapshotLegalDocument(resolution.document)
    return {
      practitioner_id: practitionerId,
      legal_document_id: document.documentId,
      legal_document_version: document.version,
      legal_document_body_sha256: document.bodySha256,
      legal_document_effective_at: document.effectiveAt,
      legal_jurisdiction: document.jurisdiction,
      legal_product_scope: document.productScope,
      acceptance_context: 'e2e_fixture_seed_v1',
      acceptance_method: 'automated_test_fixture',
      accepted_at: acceptedAt,
    }
  })
  const { error } = await supabase
    .from('practitioner_legal_acceptances')
    .upsert(rows, {
      onConflict: 'practitioner_id,legal_document_id,legal_document_version,legal_document_body_sha256,legal_document_effective_at,legal_jurisdiction,legal_product_scope,acceptance_context',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`Could not seed fixture legal acceptances: ${error.message}`)
}

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
      await seedFixtureLegalAcceptances(supabase, existingUser.id)
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

    await seedFixtureLegalAcceptances(supabase, data.user.id)

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
