import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { clinicalContentUnavailableResponse, CLINICAL_CONTENT_NO_STORE } from '@/lib/clinical-content/http'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import {
  approvedClinicalExercises,
  approvedClinicalLinks,
  approvedClinicalMuscles,
  approvedExerciseMuscles,
} from '@/lib/clinical-content/catalog'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/**
 * Muscle detail for the results-page modal: authored anatomy/function/screening copy, the
 * approved imbalance links with their rationale, and (when recommendations are released) the
 * approved exercises that stretch or strengthen it. Same practitioner + clinical-access gates as
 * the exercise route and the /muscles/[slug] page; unreleased muscles 404.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CLINICAL_CONTENT_NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const access = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  if (!access.surfaces.knowledgeLinks) return clinicalContentUnavailableResponse()

  const parsedSlug = slugSchema.safeParse((await params).slug)
  const slug = parsedSlug.success ? parsedSlug.data : null
  const muscle = slug && access.approvedMuscleSlugs.includes(slug)
    ? approvedClinicalMuscles(access).find((candidate) => candidate.slug === slug)
    : undefined
  if (!muscle) {
    return NextResponse.json({ error: 'Muscle not found' }, { status: 404, headers: CLINICAL_CONTENT_NO_STORE })
  }

  const links = approvedClinicalLinks(access)
    .filter((entry) => entry.muscle.slug === muscle.slug)
    .map(({ link }) => ({
      imbalance_key: link.imbalanceKey,
      role: link.role,
      rationale: link.rationale,
      confidence: link.confidence ?? null,
    }))

  const exercises = access.surfaces.recommendations
    ? approvedClinicalExercises(access).flatMap((exercise) =>
        approvedExerciseMuscles(access, exercise)
          .filter((link) => link.muscleSlug === muscle.slug)
          .map((link) => ({
            slug: exercise.slug,
            name: exercise.name,
            category: exercise.category,
            role: link.role,
            progression_level: link.progressionLevel,
          })),
      )
    : []

  return NextResponse.json(
    {
      muscle: {
        slug: muscle.slug,
        name: muscle.name,
        region: muscle.region,
        anatomy: muscle.anatomySummary,
        function: muscle.functionText,
        screening_notes: muscle.screeningNotes,
      },
      links,
      exercises,
    },
    { headers: CLINICAL_CONTENT_NO_STORE },
  )
}
