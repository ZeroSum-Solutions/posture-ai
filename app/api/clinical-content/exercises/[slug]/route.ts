import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { clinicalContentUnavailableResponse, CLINICAL_CONTENT_NO_STORE } from '@/lib/clinical-content/http'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { approvedClinicalExercises, approvedExerciseMuscles } from '@/lib/clinical-content/catalog'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

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
  if (!access.surfaces.recommendations) return clinicalContentUnavailableResponse()

  const parsedSlug = slugSchema.safeParse((await params).slug)
  if (!parsedSlug.success || !access.approvedExerciseSlugs.includes(parsedSlug.data)) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404, headers: CLINICAL_CONTENT_NO_STORE })
  }

  const exercise = approvedClinicalExercises(access).find((candidate) => candidate.slug === parsedSlug.data)
  if (!exercise) {
    return NextResponse.json({ error: 'Exercise not found' }, { status: 404, headers: CLINICAL_CONTENT_NO_STORE })
  }

  const detail = {
    name: exercise.name,
    category: exercise.category,
    instructions: exercise.instructions,
    sets: exercise.sets,
    hold_seconds: exercise.holdSeconds,
    video_url: exercise.media?.loopUrl ?? null,
    poster_url: exercise.media?.posterUrl ?? null,
  }
  const muscles = approvedExerciseMuscles(access, exercise)
    .map((muscle) => ({ muscle_slug: muscle.muscleSlug, role: muscle.role }))

  return NextResponse.json({ detail, muscles }, { headers: CLINICAL_CONTENT_NO_STORE })
}
