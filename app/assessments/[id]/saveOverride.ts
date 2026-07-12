import type { Capability } from '@/lib/program/selectPriorities'

export interface OverridePatch {
  capability?: Capability
  priority_keys?: string[] | null
  exercise_swaps?: Record<string, Record<string, string>>
}

/**
 * Persist a single coach-override patch and report whether it actually landed.
 *
 * `fetch` resolves (it does NOT reject) on 4xx/5xx, so the caller MUST inspect this
 * boolean — assuming success would let a failed save go silent while the optimistic
 * UI, and the client PDF later rebuilt from the persisted row, diverge from the DB.
 */
export async function saveOverridePatch(assessmentId: string, patch: OverridePatch): Promise<boolean> {
  try {
    const r = await fetch('/api/assessments/' + assessmentId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return r.ok
  } catch {
    return false
  }
}
