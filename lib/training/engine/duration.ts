import { z } from 'zod'

const durationInputSchema = z.object({
  exercises: z.array(z.object({
    sets: z.number().int().min(1).max(20),
    repCeiling: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(3_600),
    secondsPerRep: z.number().int().min(1).max(60).optional(),
  }).strict()).min(1).max(50),
  warmupSeconds: z.number().int().min(0).max(14_400),
  cooldownSeconds: z.number().int().min(0).max(14_400),
  preparationSeconds: z.number().int().min(0).max(14_400),
  budgetMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]).default(30),
}).strict()

export interface DynamicSessionDuration {
  readonly durationSeconds: number
  readonly fitsBudget: boolean
  readonly budgetSeconds: number
}

export function estimateDynamicSessionDuration(input: unknown): DynamicSessionDuration {
  const parsed = durationInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('Invalid duration input')

  const exerciseSeconds = parsed.data.exercises.reduce((total, exercise) => (
    total
    + exercise.sets * exercise.repCeiling * (exercise.secondsPerRep ?? 4)
    + (exercise.sets - 1) * exercise.restSeconds
  ), 0)
  const betweenExerciseSeconds = (parsed.data.exercises.length - 1) * 60
  const durationSeconds = exerciseSeconds
    + betweenExerciseSeconds
    + parsed.data.warmupSeconds
    + parsed.data.cooldownSeconds
    + parsed.data.preparationSeconds
  const budgetSeconds = parsed.data.budgetMinutes * 60

  return Object.freeze({
    durationSeconds,
    fitsBudget: durationSeconds <= budgetSeconds,
    budgetSeconds,
  })
}
