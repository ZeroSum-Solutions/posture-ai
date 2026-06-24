import type { ExerciseContent } from '../../content/muscles/types'

export type Week = 1 | 2 | 3
export type DosageType = 'hold' | 'dynamic'

export interface Dose {
  sets: number
  reps: number | null
  seconds: number | null
  type: DosageType
}

const clampHold = (target: number, authored: number) => Math.min(target, Math.min(authored, 60))

/**
 * Dosage for one exercise in a given week of the 3-week ramp. Same exercises
 * run all 3 weeks; only the numbers move. Severity never scales dosage.
 * Integrative ("Connect") items appear only in Week 3, introduced light.
 */
export function computeDose(ex: ExerciseContent, week: Week, isIntegrative = false): Dose | null {
  if (isIntegrative) {
    return week === 3 ? { sets: 2, reps: 10, seconds: null, type: 'dynamic' } : null
  }
  switch (ex.category) {
    case 'stretch':
      // honor the authored hold; ramp sets, never seconds past W2.
      return { sets: week === 1 ? 2 : 3, reps: null, seconds: ex.holdSeconds, type: 'hold' }
    case 'mobility':
      return { sets: week === 1 ? 1 : 2, reps: week === 3 ? 10 : 8, seconds: null, type: 'dynamic' }
    case 'activation':
      return { sets: 2, reps: week === 1 ? 10 : week === 2 ? 12 : 15, seconds: null, type: 'dynamic' }
    case 'strengthen':
      // Authored dosageType decides hold-vs-dynamic — never inferred from holdSeconds.
      if (ex.dosageType === 'hold') {
        const target = [20, 30, 40][week - 1]
        return { sets: 2, reps: null, seconds: clampHold(target, ex.holdSeconds), type: 'hold' }
      }
      // dynamic strengthen: the single allowed set-add lands in week 3.
      return { sets: week === 3 ? 3 : 2, reps: week === 1 ? 10 : week === 2 ? 12 : 15, seconds: null, type: 'dynamic' }
    default:
      return null // informational
  }
}

/** Weekly frequency guidance, by category. */
export function freqLabel(category: ExerciseContent['category']): string {
  switch (category) {
    case 'stretch':
      return 'daily (5–7×/wk)'
    case 'mobility':
      return 'daily'
    case 'activation':
    case 'strengthen':
      return '3–4×/wk'
    default:
      return ''
  }
}

/** Compact, client-safe dose string for one cell, e.g. "2×12" or "Hold 30s ×2". */
export function renderDose(dose: Dose | null): string {
  if (!dose) return '—'
  if (dose.type === 'hold' && dose.seconds != null) return `Hold ${dose.seconds}s ×${dose.sets}`
  if (dose.reps != null) return `${dose.sets}×${dose.reps}`
  return `${dose.sets} sets`
}
