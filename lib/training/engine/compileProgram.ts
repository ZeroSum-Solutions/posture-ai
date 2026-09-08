import { z } from 'zod'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  MovementPatternV1Schema,
  TrainingCatalogV1Schema,
  type ConditioningModeV1,
  type MovementPatternV1,
  type TrainingCatalogV1,
  type TrainingExerciseV1,
} from '../catalog/types'
import type { EquipmentLoadBasis, EquipmentInventory } from '../equipment'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '../quantity'
import { estimateDynamicSessionDuration } from './duration'
import {
  WEEKDAYS,
  expandLocalDates,
  resolveStrengthSchedule,
  type ScheduledStrengthDay,
  type StrengthSessionType,
  type Weekday,
} from './schedule'

export const COMPILED_PROGRAM_SCHEMA_VERSION = 'compiled-program.v1' as const
export const PROGRAM_COMPILER_POLICY_VERSION = 'eight-week-compiler.v1' as const

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const compileInputSchema = z.object({
  subjectId: stableIdSchema,
  profileRevisionId: stableIdSchema,
  programRevisionId: stableIdSchema,
  cycleStartLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conditioningModalityId: stableIdSchema,
  profile: AthleteTrainingProfileV1Schema,
  catalog: TrainingCatalogV1Schema,
}).strict()

const REQUIRED_PATTERNS = MovementPatternV1Schema.options
const PHASES = [
  'calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review',
] as const

type ProgramPhase = typeof PHASES[number]

interface SelectedExercise {
  readonly exercise: TrainingExerciseV1
  readonly equipmentId: string
  readonly basis: EquipmentLoadBasis
}

export interface CompiledExerciseV1 {
  readonly exerciseInstanceId: string
  readonly exerciseVersionId: string
  readonly movementPattern: MovementPatternV1
  readonly equipmentId: string
  readonly loadBasis: EquipmentLoadBasis
  readonly setIds: readonly string[]
  readonly repRange: { readonly minimum: number; readonly maximum: number }
  readonly targetRir: { readonly minimum: 2; readonly maximum: 3 }
  readonly restSeconds: 120
  readonly loadSelection: {
    readonly status: 'requires_explicit_acceptance'
    readonly familiarizationHistoryAvailable: boolean
  }
}

export interface CompiledStrengthSessionV1 {
  readonly sessionId: string
  readonly sessionType: StrengthSessionType
  readonly weekday: Weekday
  readonly scheduledLocalDate: string
  readonly athleteTimezone: string
  readonly estimatedDurationSeconds: number
  readonly warmupSeconds: 300
  readonly cooldownSeconds: 120
  readonly exercises: readonly CompiledExerciseV1[]
}

export interface CompiledConditioningBoutV1 {
  readonly boutId: string
  readonly modalityId: string
  readonly weekday: Weekday
  readonly scheduledLocalDate: string
  readonly athleteTimezone: string
  readonly durationOfferSeconds: 600
  readonly allowedDurationSeconds: { readonly minimum: 60; readonly maximum: 1_200 }
  readonly effortCue: string
  readonly status: 'requires_explicit_acceptance'
}

export interface CompiledWeekV1 {
  readonly week: number
  readonly phase: ProgramPhase
  readonly strengthSessions: readonly CompiledStrengthSessionV1[]
  readonly conditioningBouts: readonly CompiledConditioningBoutV1[]
}

export type CompilationResultV1 =
  | {
    readonly kind: 'draft_program'
    readonly schemaVersion: typeof COMPILED_PROGRAM_SCHEMA_VERSION
    readonly compilerPolicyVersion: typeof PROGRAM_COMPILER_POLICY_VERSION
    readonly status: 'requires_explicit_acceptance'
    readonly subjectId: string
    readonly profileRevisionId: string
    readonly programRevisionId: string
    readonly catalogVersion: string
    readonly goal: AthleteTrainingProfileV1['goal']
    readonly cycleStartLocalDate: string
    readonly athleteTimezone: string
    readonly sessionTimeBudgetMinutes: AthleteTrainingProfileV1['sessionTimeBudgetMinutes']
    readonly scheduleKind: 'full_body' | 'upper_lower'
    readonly weeks: readonly CompiledWeekV1[]
  }
  | {
    readonly kind: 'schedule_adjustment_required'
    readonly reason: 'nonconsecutive_schedule_required'
    readonly requestedDays: readonly Weekday[]
    readonly alternatives: readonly {
      readonly preservedRequestedDays: number
      readonly movedSessions: number
      readonly days: readonly ScheduledStrengthDay[]
    }[]
  }
  | {
    readonly kind: 'time_budget_insufficient'
    readonly reason: 'required_session_does_not_fit'
    readonly requestedBudgetMinutes: 30 | 45 | 60
    readonly requiredDurationSeconds: number
    readonly feasibleBudgetMinutes: 45 | 60 | null
  }
  | {
    readonly kind: 'needs_template_adjustment'
    readonly reason: 'required_movement_unavailable'
    readonly missingMovementPatterns: readonly MovementPatternV1[]
  }
  | {
    readonly kind: 'needs_template_adjustment'
    readonly reason: 'conditioning_modality_unavailable'
    readonly missingMovementPatterns: readonly []
  }

function expectedBasis(inventory: EquipmentInventory): EquipmentLoadBasis {
  if (inventory.kind === 'barbell') return 'barbell_total'
  if (inventory.kind === 'dumbbell') return 'dumbbell_per_hand'
  return 'machine_stack'
}

function isSelectableExercise(exercise: TrainingExerciseV1, catalog: TrainingCatalogV1): boolean {
  if (exercise.lifecycle !== 'active') return false
  if (catalog.origin.kind === 'synthetic_fixture') {
    return exercise.contentReviewStatus === 'reviewed_fixture' && exercise.mediaStatus === 'reviewed_static_fixture'
  }
  return exercise.contentReviewStatus === 'reviewed' && exercise.mediaStatus === 'reviewed_exact_variant'
}

function isSelectableConditioning(mode: ConditioningModeV1, catalog: TrainingCatalogV1): boolean {
  if (mode.lifecycle !== 'active') return false
  return catalog.origin.kind === 'synthetic_fixture'
    ? mode.contentReviewStatus === 'reviewed_fixture'
    : mode.contentReviewStatus === 'reviewed'
}

function inventoryHasExplicitLoadInBounds(
  inventory: EquipmentInventory,
  minimumCanonicalKg: string,
  maximumCanonicalKg: string,
): boolean {
  // Barbell combinations must come from the equipment enumerator in the next
  // equipment slice; this compiler does not duplicate plate-pair arithmetic.
  if (inventory.kind === 'barbell') return false
  const values = inventory.kind === 'dumbbell' ? inventory.perHandLoads : inventory.stackLoads
  return values.some((value) => {
    const load = createLoadQuantity({ value, unit: inventory.unit })
    return isEnteredLoadAtMostCanonicalKg({ value: minimumCanonicalKg, unit: 'kg' }, load.canonicalKg)
      && isEnteredLoadAtMostCanonicalKg(load.entered, maximumCanonicalKg)
  })
}

function selectExercise(
  pattern: MovementPatternV1,
  catalog: TrainingCatalogV1,
  inventory: readonly EquipmentInventory[],
): SelectedExercise | null {
  const sortedExercises = catalog.exercises
    .filter(exercise => exercise.movementPattern === pattern && exercise.role === 'primary' && isSelectableExercise(exercise, catalog))
    .sort((left, right) => left.preferenceRank - right.preferenceRank || left.exerciseVersionId.localeCompare(right.exerciseVersionId))
  const sortedInventory = [...inventory].sort((left, right) => left.equipmentId.localeCompare(right.equipmentId))

  for (const exercise of sortedExercises) {
    for (const equipment of sortedInventory) {
      const basis = expectedBasis(equipment)
      if (exercise.equipmentCompatibility.some(option => (
        option.kind === equipment.kind
        && option.basis === basis
        && inventoryHasExplicitLoadInBounds(equipment, option.minimumCanonicalKg, option.maximumCanonicalKg)
      ))) {
        return { exercise, equipmentId: equipment.equipmentId, basis }
      }
    }
  }
  return null
}

function patternsForSession(sessionType: StrengthSessionType): readonly MovementPatternV1[] {
  if (sessionType === 'upper') return ['push', 'pull']
  if (sessionType === 'lower') return ['knee_dominant', 'hinge']
  return REQUIRED_PATTERNS
}

function repRange(profile: AthleteTrainingProfileV1): { minimum: number; maximum: number } {
  return profile.goal === 'strength' ? { minimum: 6, maximum: 10 } : { minimum: 8, maximum: 12 }
}

function sessionDuration(
  sessionType: StrengthSessionType,
  selections: ReadonlyMap<MovementPatternV1, SelectedExercise>,
  profile: AthleteTrainingProfileV1,
): number {
  const selected = patternsForSession(sessionType).map(pattern => selections.get(pattern) as SelectedExercise)
  return estimateDynamicSessionDuration({
    exercises: selected.map(({ exercise }) => ({
      sets: 2,
      repCeiling: repRange(profile).maximum,
      restSeconds: 120,
      secondsPerRep: exercise.secondsPerRep,
    })),
    warmupSeconds: 300,
    cooldownSeconds: 120,
    preparationSeconds: selected.reduce((sum, { exercise }) => sum + exercise.preparationSeconds, 0),
    budgetMinutes: profile.sessionTimeBudgetMinutes,
  }).durationSeconds
}

function scheduledDate(cycleStartLocalDate: string, weekday: Weekday, weekIndex: number): string {
  return expandLocalDates(cycleStartLocalDate, weekday, 8)[weekIndex]
}

function conditioningDays(strengthDays: readonly ScheduledStrengthDay[]): readonly Weekday[] {
  const used = new Set(strengthDays.map(day => day.weekday))
  return WEEKDAYS.filter(day => !used.has(day)).slice(0, 2)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

function compileExercise(
  selection: SelectedExercise,
  profile: AthleteTrainingProfileV1,
  programRevisionId: string,
  week: number,
  sessionOrdinal: number,
): CompiledExerciseV1 {
  const exerciseInstanceId = `${programRevisionId}:w${week}:s${sessionOrdinal}:${selection.exercise.exerciseVersionId}`
  return {
    exerciseInstanceId,
    exerciseVersionId: selection.exercise.exerciseVersionId,
    movementPattern: selection.exercise.movementPattern,
    equipmentId: selection.equipmentId,
    loadBasis: selection.basis,
    setIds: [1, 2].map(set => `${exerciseInstanceId}:set${set}`),
    repRange: repRange(profile),
    targetRir: { minimum: 2, maximum: 3 },
    restSeconds: 120,
    loadSelection: {
      status: 'requires_explicit_acceptance',
      familiarizationHistoryAvailable: profile.startingHistory.some(history => (
        history.exerciseVersionId === selection.exercise.exerciseVersionId
        && history.equipmentLoad.equipmentId === selection.equipmentId
        && history.equipmentLoad.basis === selection.basis
      )),
    },
  }
}

export function compileEightWeekProgram(input: unknown): CompilationResultV1 {
  const parsed = compileInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('Invalid compiler input')
  const { profile, catalog } = parsed.data
  if (profile.cycleLengthWeeks !== 8) throw new Error('Only the eight-week compiler is supported')

  // Validate the local calendar anchor without converting it to an athlete instant.
  expandLocalDates(parsed.data.cycleStartLocalDate, 'monday', 1)

  const schedule = resolveStrengthSchedule(profile.strengthDays)
  if (schedule.kind === 'adjustment_required') {
    return deepFreeze({
      kind: 'schedule_adjustment_required',
      reason: 'nonconsecutive_schedule_required',
      requestedDays: schedule.requestedDays,
      alternatives: schedule.alternatives,
    })
  }

  const selections = new Map<MovementPatternV1, SelectedExercise>()
  const missingMovementPatterns: MovementPatternV1[] = []
  for (const pattern of REQUIRED_PATTERNS) {
    const selection = selectExercise(pattern, catalog, profile.equipmentInventory)
    if (selection) selections.set(pattern, selection)
    else missingMovementPatterns.push(pattern)
  }
  if (missingMovementPatterns.length > 0) {
    return deepFreeze({ kind: 'needs_template_adjustment', reason: 'required_movement_unavailable', missingMovementPatterns })
  }

  const conditioningMode = catalog.conditioningModes.find(mode => (
    mode.modalityId === parsed.data.conditioningModalityId && isSelectableConditioning(mode, catalog)
  ))
  if (!conditioningMode) {
    return deepFreeze({ kind: 'needs_template_adjustment', reason: 'conditioning_modality_unavailable', missingMovementPatterns: [] })
  }

  const requiredDurationSeconds = Math.max(...schedule.days.map(day => sessionDuration(day.sessionType, selections, profile)))
  if (requiredDurationSeconds > profile.sessionTimeBudgetMinutes * 60) {
    const feasibleBudgetMinutes = ([45, 60] as const).find(minutes => (
      minutes > profile.sessionTimeBudgetMinutes && requiredDurationSeconds <= minutes * 60
    )) ?? null
    return deepFreeze({
      kind: 'time_budget_insufficient',
      reason: 'required_session_does_not_fit',
      requestedBudgetMinutes: profile.sessionTimeBudgetMinutes,
      requiredDurationSeconds,
      feasibleBudgetMinutes,
    })
  }

  const offDays = conditioningDays(schedule.days)
  const weeks: CompiledWeekV1[] = PHASES.map((phase, weekIndex) => {
    const week = weekIndex + 1
    const strengthSessions = schedule.days.map((day, sessionIndex): CompiledStrengthSessionV1 => ({
      sessionId: `${parsed.data.programRevisionId}:w${week}:strength${sessionIndex + 1}`,
      sessionType: day.sessionType,
      weekday: day.weekday,
      scheduledLocalDate: scheduledDate(parsed.data.cycleStartLocalDate, day.weekday, weekIndex),
      athleteTimezone: profile.localTimezone,
      estimatedDurationSeconds: sessionDuration(day.sessionType, selections, profile),
      warmupSeconds: 300,
      cooldownSeconds: 120,
      exercises: patternsForSession(day.sessionType).map(pattern => compileExercise(
        selections.get(pattern) as SelectedExercise,
        profile,
        parsed.data.programRevisionId,
        week,
        sessionIndex + 1,
      )),
    }))
    const conditioningBouts = offDays.map((weekday, boutIndex): CompiledConditioningBoutV1 => ({
      boutId: `${parsed.data.programRevisionId}:w${week}:conditioning${boutIndex + 1}`,
      modalityId: conditioningMode.modalityId,
      weekday,
      scheduledLocalDate: scheduledDate(parsed.data.cycleStartLocalDate, weekday, weekIndex),
      athleteTimezone: profile.localTimezone,
      durationOfferSeconds: 600,
      allowedDurationSeconds: { minimum: 60, maximum: 1_200 },
      effortCue: conditioningMode.effortCue,
      status: 'requires_explicit_acceptance',
    }))
    return { week, phase, strengthSessions, conditioningBouts }
  })

  return deepFreeze({
    kind: 'draft_program',
    schemaVersion: COMPILED_PROGRAM_SCHEMA_VERSION,
    compilerPolicyVersion: PROGRAM_COMPILER_POLICY_VERSION,
    status: 'requires_explicit_acceptance',
    subjectId: parsed.data.subjectId,
    profileRevisionId: parsed.data.profileRevisionId,
    programRevisionId: parsed.data.programRevisionId,
    catalogVersion: catalog.catalogVersion,
    goal: profile.goal,
    cycleStartLocalDate: parsed.data.cycleStartLocalDate,
    athleteTimezone: profile.localTimezone,
    sessionTimeBudgetMinutes: profile.sessionTimeBudgetMinutes,
    scheduleKind: schedule.scheduleKind,
    weeks,
  })
}
