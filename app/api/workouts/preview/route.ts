import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { serverClinicalContentAccessForPractitioner } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'
import { buildSessionFromAssessment } from '@/lib/workout/buildSessionFromAssessment'
import type { StoredFinding } from '@/lib/findings/storedFindingToEngine'
import {
  personalizeWorkout,
  workoutPreferencesSchema,
  workoutSummary,
  WORKOUT_GOALS,
} from '@/lib/workout/personalize'

export const runtime = 'nodejs'
export const maxDuration = 30

const requestSchema = z.object({
  assessment_id: z.string().uuid(),
  preferences: workoutPreferencesSchema,
  mode: z.enum(['scan', 'ai']),
}).strict()

const providerSelectionSchema = z.object({
  slugs: z.array(z.string().max(90)).min(1).max(24),
}).strict()

function workoutProvider() {
  if (process.env.POSTURE_WORKOUT_AI_PROVIDER === 'deepseek') {
    return {
      url: 'https://api.deepseek.com/chat/completions',
      apiKey: process.env.POSTURE_WORKOUT_DEEPSEEK_API_KEY,
      model: process.env.POSTURE_WORKOUT_DEEPSEEK_MODEL,
      extras: { thinking: { type: 'disabled' } },
    }
  }
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.POSTURE_WORKOUT_OPENROUTER_API_KEY,
    model: process.env.POSTURE_WORKOUT_OPENROUTER_MODEL,
    extras: { reasoning: { effort: 'minimal' } },
  }
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Check the assessment and workout preferences.' }, { status: 422 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const access = await serverClinicalContentAccessForPractitioner(user.id)
  if (!access.surfaces.workouts) return clinicalContentUnavailableResponse()

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, {
    route: 'workouts_preview',
    userId: user.id,
    limit: 20,
    windowSeconds: 60,
  })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })

  const { assessment_id: assessmentId, preferences, mode } = parsed.data
  const { data: assessment } = await service
    .from('assessments')
    .select('id, client_id, overall_grade, capability, priority_keys, exercise_swaps, practitioner_approved, status')
    .eq('id', assessmentId)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (!assessment) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  if (assessment.status !== 'complete') {
    return NextResponse.json({ error: 'Assessment analysis is not complete.' }, { status: 409 })
  }
  if (!assessment.practitioner_approved) {
    return NextResponse.json({ error: 'Approve the assessment before building a workout.' }, { status: 403 })
  }

  const { data: findings, error: findingsError } = await service
    .from('assessment_findings')
    .select('imbalance_key, label, region, deviation, direction, severity_pct, zone, view_used, confidence')
    .eq('assessment_id', assessmentId)
  if (findingsError) return NextResponse.json({ error: 'Failed to load findings.' }, { status: 500 })

  const candidates = buildSessionFromAssessment(
    { ...assessment, capability: preferences.capability },
    (findings ?? []) as StoredFinding[],
    1,
    {
      approvedExerciseSlugs: access.approvedExerciseSlugs,
      approvedLinkIds: access.approvedLinkIds,
      approvedReportCopyIds: access.approvedReportCopyIds,
    },
  )
  if (!candidates) {
    return NextResponse.json({
      error: 'This assessment has no reliable findings to build a workout from.',
    }, { status: 422 })
  }

  let source: 'ai' | 'scan' = 'scan'
  let snapshot
  try {
    snapshot = personalizeWorkout(candidates, preferences)
  } catch (cause) {
    return NextResponse.json({
      error: cause instanceof Error ? cause.message : 'No movements match these preferences.',
    }, { status: 422 })
  }
  let notice = 'Built from the client assessment using the authored movement library.'

  if (mode === 'ai') {
    const provider = workoutProvider()
    if (provider.apiKey && provider.model) {
      try {
        const response = await fetch(provider.url, {
          method: 'POST',
          signal: AbortSignal.timeout(18_000),
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: provider.model,
            max_tokens: 1200,
            ...provider.extras,
            temperature: 0.25,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: 'Select a coherent workout subset from the supplied authored exercise catalog. Return only JSON {"slugs":["allowed-slug"]}. Use only catalog slugs, each once. Prefer preparation before strength. Do not invent exercises, clinical conclusions, dosage, or advice.',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  preferences,
                  catalog: candidates.items.map((item) => ({
                    slug: item.slug,
                    category: item.category,
                    focus: item.priorityKey,
                  })),
                }),
              },
            ],
          }),
        })
        if (!response.ok) throw new Error('Provider unavailable')
        const data = await response.json()
        const content = data?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content.length > 8_000) throw new Error('Invalid provider response')
        const selection = providerSelectionSchema.parse(JSON.parse(content))
        snapshot = personalizeWorkout(candidates, preferences, selection.slugs)
        source = 'ai'
        notice = 'AI selected from movements admitted by the assessment and authored movement library.'
      } catch {
        notice = 'AI could not finish this request. The scan-selected workout is ready to review.'
      }
    } else {
      notice = 'Live AI is unavailable. The scan-selected workout is ready to review.'
    }
  }

  return NextResponse.json({
    name: WORKOUT_GOALS[preferences.goal],
    snapshot,
    source,
    summary: workoutSummary(snapshot),
    notice,
    assessment_id: assessmentId,
    client_id: assessment.client_id,
    approved: assessment.practitioner_approved === true,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
