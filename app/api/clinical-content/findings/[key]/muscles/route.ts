import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { clinicalContentUnavailableResponse, CLINICAL_CONTENT_NO_STORE } from '@/lib/clinical-content/http'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { approvedClinicalLinks } from '@/lib/clinical-content/catalog'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const findingKeySchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CLINICAL_CONTENT_NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const access = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  if (!access.surfaces.knowledgeLinks) return clinicalContentUnavailableResponse()

  const parsedKey = findingKeySchema.safeParse((await params).key)
  if (!parsedKey.success) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404, headers: CLINICAL_CONTENT_NO_STORE })
  }

  const muscles = approvedClinicalLinks(access)
    .filter(({ link }) => link.imbalanceKey === parsedKey.data && link.scored !== false)
    .map(({ muscle, link }) => ({
      slug: muscle.slug,
      name: muscle.name,
      role: link.role,
      confidence: link.confidence,
    }))

  return NextResponse.json({ muscles }, { headers: CLINICAL_CONTENT_NO_STORE })
}
