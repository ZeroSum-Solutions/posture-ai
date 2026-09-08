/** Browser-safe compiler choices; draft construction and hashing remain server-owned. */
export const ACTIVE_PROGRAM_COMPILER_OPTIONS = Object.freeze({
  cycleLengthWeeks: Object.freeze([8] as const),
  strengthDaysPerWeek: Object.freeze([2, 3, 4] as const),
  sessionTimeBudgetMinutes: Object.freeze([30, 45, 60] as const),
  goals: Object.freeze(['strength', 'general_fitness'] as const),
})
