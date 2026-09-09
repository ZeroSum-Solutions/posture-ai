import {
  ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION,
  AthleteTrainingProfileV1Schema,
  type AthleteTrainingProfileV1,
} from '@/lib/training/contracts/profile'

const shape = AthleteTrainingProfileV1Schema.shape

export const profileOptionValues = Object.freeze({
  goals: [...shape.goal.options],
  experience: [...shape.experience.options],
  recentConsistency: [...shape.recentConsistency.options],
  cycleLengths: shape.cycleLengthWeeks.options.map(option => option.value),
  sessionMinutes: shape.sessionTimeBudgetMinutes.options.map(option => option.value),
  loadUnits: [...shape.preferredLoadUnit.options],
  weekdays: [...shape.strengthDays.element.options],
})

export type StrengthProfileValidation =
  | { status: 'valid'; profile: AthleteTrainingProfileV1 }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }

export function createInitialStrengthProfile(localTimezone: string): AthleteTrainingProfileV1 {
  return AthleteTrainingProfileV1Schema.parse({
    schemaVersion: ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION,
    origin: { kind: 'athlete_input' },
    goal: 'general_fitness',
    experience: 'beginner',
    recentConsistency: 'unknown',
    cycleLengthWeeks: 8,
    strengthDays: ['monday', 'wednesday', 'friday'],
    localTimezone,
    sessionTimeBudgetMinutes: 45,
    preferredLoadUnit: 'kg',
    equipmentInventory: [],
    startingHistory: [],
  })
}

export function validateStrengthProfile(input: unknown): StrengthProfileValidation {
  const parsed = AthleteTrainingProfileV1Schema.safeParse(input)
  if (parsed.success) return { status: 'valid', profile: parsed.data }

  const fieldErrors: Record<string, string[]> = {}
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'profile')
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message]
  }
  return { status: 'invalid', fieldErrors }
}
