import { z } from 'zod'
import { guardDemoGeneration } from '@/lib/demo/api-guard'
import { workoutCandidates, workoutRequestSchema, selectWorkoutItems, workoutSummary, WORKOUT_GOALS } from '@/lib/demo/workout'

export const runtime = 'nodejs'
export const maxDuration = 30
const selectionSchema = z.object({ slugs: z.array(z.string().max(90)).min(1).max(24) }).strict()

export async function POST(req: Request) {
  const denied = await guardDemoGeneration(req)
  if (denied) return denied
  const raw = await req.text()
  if (raw.length > 24_000) return Response.json({ error: 'Request too large.' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }) }
  const parsed = workoutRequestSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Check the scan and workout preferences.' }, { status: 422 })
  const { findings, preferences } = parsed.data
  const candidates = workoutCandidates(findings, preferences)
  if (!candidates) return Response.json({ error: 'No supported movements match this scan and equipment. Try a sample scan or add available equipment.' }, { status: 422 })
  let source: 'ai' | 'scan' = 'scan'
  let snapshot = selectWorkoutItems(candidates, preferences)
  let notice = 'A scan-based plan is ready. Live AI is unavailable right now.'
  const apiKey = process.env.POSTURE_DEMO_OPENROUTER_API_KEY
  const model = process.env.POSTURE_DEMO_OPENROUTER_MODEL
  if (apiKey && model) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(18_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1200, reasoning: { effort: 'minimal' }, temperature: 0.25, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: 'Select a coherent workout subset from the supplied authored exercise catalog for the goal and time budget. Return only JSON {"slugs":["allowed-slug"]}. Use only catalog slugs, each once. Prefer at least 3 movements when possible and include preparation before strength. Do not invent exercises, clinical conclusions, dosage or advice.' },
          { role: 'user', content: JSON.stringify({ preferences, catalog: candidates.items.map((item) => ({ slug: item.slug, category: item.category, focus: item.priorityKey, estimatedSeconds: Math.ceil((item.timing.kind === 'hold' ? item.timing.secondsPerSet : item.timing.repsPerSet * 4) * item.timing.sets + item.timing.restSeconds * (item.timing.sets - 1) + 8) })) }) },
        ] }),
      })
      if (!response.ok) throw new Error('Provider unavailable')
      const data = await response.json()
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.length > 8_000) throw new Error('Invalid provider response')
      const selection = selectionSchema.parse(JSON.parse(content))
      snapshot = selectWorkoutItems(candidates, preferences, selection.slugs)
      source = 'ai'
      notice = 'AI selected movements from your scan-based exercise options. Instructions and timing come from the authored movement library.'
    } catch {
      // The visible source and notice distinguish a working fallback from live AI.
      notice = 'AI could not finish this request. Your scan-based plan is ready; retry AI whenever you like.'
    }
  }
  return Response.json({ name: WORKOUT_GOALS[preferences.goal], snapshot, source, summary: workoutSummary(snapshot), notice }, { headers: { 'Cache-Control': 'no-store' } })
}
