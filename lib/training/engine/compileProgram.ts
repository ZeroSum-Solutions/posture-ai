import { z } from 'zod'
import { createHash } from 'node:crypto'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '../contracts/profile'
import { ExecutionContextV1Schema, type ExecutionContextV1 } from '../contracts/program'
import {
  compareEnteredLoadQuantities,
  createLoadQuantity,
  type ExactLoadQuantity,
} from '../quantity'
import {
  MovementPatternV1Schema,
  TrainingCatalogV1Schema,
  type ConditioningModeV1,
  type BodyweightAssistancePolicyReferenceV1,
  type ExerciseProgressionDefaultsV1,
  type MovementPatternV1,
  type TrainingCatalogOriginV1,
  type TrainingCatalogV1,
  type TrainingExerciseV1,
} from '../catalog/types'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  SYNTHETIC_STARTER_PROGRESSION_DEFAULTS,
} from '../catalog/syntheticStarter'
import {
  enumerateEquipmentLoadsWithinBounds,
  type EquipmentLoadBasis,
  type EquipmentInventory,
} from '../equipment'
import { estimateDynamicSessionDuration } from './duration'
import {
  WEEKDAYS,
  expandLocalDates,
  resolveStrengthSchedule,
  type ScheduledStrengthDay,
  type StrengthSessionType,
  type Weekday,
} from './schedule'
import { movementOccurrenceIndex, undulatingExposureForOccurrence } from './exposureSchedule'
import {
  StrengthProgrammingStyleV1Schema,
  resolveIntermediateUndulatingTemplate,
  type IntermediateUndulatingTemplateV1,
  type StrengthProgrammingStyleV1,
  type StrengthTemplateRegistryV1,
} from './strengthTemplate'

export const COMPILED_PROGRAM_SCHEMA_VERSION = 'compiled-program.v1' as const
export const PROGRAM_COMPILER_POLICY_VERSION = 'strength-cycle-compiler.v3' as const

export interface CompileTrainingProgramOptions {
  readonly strengthProgrammingStyle?: StrengthProgrammingStyleV1
  readonly strengthTemplateRegistry?: StrengthTemplateRegistryV1
}

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const compileInputSchema = z.object({
  subjectId: stableIdSchema,
  profileRevisionId: stableIdSchema,
  programRevisionId: stableIdSchema,
  cycleStartLocalDate: z.string().max(32),
  conditioningModalityId: stableIdSchema,
  executionContext: ExecutionContextV1Schema,
  profile: AthleteTrainingProfileV1Schema,
  catalog: TrainingCatalogV1Schema,
}).strict().superRefine((input, ctx) => {
  if (input.executionContext.kind === 'live' && input.catalog.origin.kind === 'synthetic_fixture') {
    ctx.addIssue({ code: 'custom', message: 'Live compilation cannot consume a synthetic catalog', path: ['catalog', 'origin'] })
  }
  if (input.executionContext.kind === 'live' && input.profile.origin.kind === 'synthetic_fixture') {
    ctx.addIssue({ code: 'custom', message: 'Live compilation cannot consume a synthetic profile', path: ['profile', 'origin'] })
  }
  if (input.executionContext.kind === 'synthetic_simulation') {
    if (
      input.catalog.origin.kind !== 'synthetic_fixture'
      || input.catalog.origin.fixtureId !== input.executionContext.fixtureId
      || input.catalog.origin.fixtureHash !== input.executionContext.fixtureHash
    ) {
      ctx.addIssue({ code: 'custom', message: 'Simulation catalog does not match its execution context', path: ['catalog', 'origin'] })
    }
    if (
      input.profile.origin.kind !== 'synthetic_fixture'
      || input.profile.origin.fixtureId !== input.executionContext.fixtureId
    ) {
      ctx.addIssue({ code: 'custom', message: 'Simulation profile does not match its execution context', path: ['profile', 'origin'] })
    }
  }
})

const REQUIRED_PATTERNS = MovementPatternV1Schema.options
const CYCLE_PHASES = Object.freeze({
  4: Object.freeze(['calibration', 'build', 'build', 'review'] as const),
  6: Object.freeze(['calibration', 'build', 'build', 'review_adjust', 'build', 'review'] as const),
  8: Object.freeze(['calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review'] as const),
  12: Object.freeze([
    'calibration', 'build', 'build', 'review_adjust',
    'build', 'build', 'build', 'review_adjust',
    'build', 'build', 'build', 'review',
  ] as const),
})

type ProgramPhase = (typeof CYCLE_PHASES)[keyof typeof CYCLE_PHASES][number]

interface SelectedExercise {
  readonly exercise: TrainingExerciseV1
  readonly equipmentId: string
  readonly basis: EquipmentLoadBasis
  readonly implementCount: 0 | 1 | 2
  readonly holdingConfiguration:
    | 'two_hands_single_implement'
    | 'one_per_hand'
    | 'both_hands_barbell'
    | 'machine_defined'
    | 'bodyweight_plus_external_load'
    | 'machine_assistance'
  readonly bodyweightAssistancePolicy?: BodyweightAssistancePolicyReferenceV1
  readonly minimumCanonicalKg: string
  readonly maximumCanonicalKg: string
  readonly progressionDefaults: ExerciseProgressionDefaultsV1
  readonly warmupSets: readonly {
    readonly targetReps: number
    readonly prescribedLoad: ExactLoadQuantity
  }[]
}

export interface CompiledExerciseV1 {
  readonly exerciseInstanceId: string
  readonly exerciseVersionId: string
  readonly movementPattern: MovementPatternV1
  readonly equipmentId: string
  readonly loadBasis: EquipmentLoadBasis
  readonly implementCount: 0 | 1 | 2
  readonly holdingConfiguration: SelectedExercise['holdingConfiguration']
  readonly bodyweightAssistancePolicy?: BodyweightAssistancePolicyReferenceV1
  readonly warmupSets?: readonly {
    readonly setId: string
    readonly targetReps: number
    readonly prescribedLoad: ExactLoadQuantity
  }[]
  readonly setIds: readonly string[]
  readonly repRange: { readonly minimum: number; readonly maximum: number }
  readonly targetRir: { readonly minimum: 2; readonly maximum: 3 }
  readonly restSeconds: number
  readonly progression: {
    readonly progressionSeriesId: string
    readonly side: 'bilateral' | 'left' | 'right' | 'not_applicable'
    readonly rom: string
    readonly tempo: string
    readonly exposureType: string
    readonly loadEpoch: 1
  }
  readonly loadSelection: {
    readonly status: 'requires_explicit_acceptance'
    readonly familiarizationHistoryAvailable: boolean
    readonly minimumCanonicalKg: string
    readonly maximumCanonicalKg: string
  }
}

export interface CompiledStrengthSessionV1 {
  readonly sessionId: string
  readonly sessionType: StrengthSessionType
  readonly weekday: Weekday
  readonly scheduledLocalDate: string
  readonly athleteTimezone: string
  readonly estimatedDurationSeconds: number
  readonly warmupSeconds: number
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

export type CompilationResultV1 = {
  readonly executionContext: ExecutionContextV1
} & (
  | {
    readonly kind: 'invalid_anchor_date'
    readonly reason: 'invalid_local_cycle_start'
    readonly requestedValue: string
  }
  | {
    readonly kind: 'draft_program'
    readonly schemaVersion: typeof COMPILED_PROGRAM_SCHEMA_VERSION
    readonly compilerPolicyVersion: typeof PROGRAM_COMPILER_POLICY_VERSION
    readonly status: 'requires_explicit_acceptance'
    readonly subjectId: string
    readonly profileRevisionId: string
    readonly programRevisionId: string
    readonly catalogVersion: string
    readonly catalogOrigin: TrainingCatalogOriginV1
    readonly goal: AthleteTrainingProfileV1['goal']
    readonly cycleLengthWeeks: AthleteTrainingProfileV1['cycleLengthWeeks']
    readonly cycleStartLocalDate: string
    readonly athleteTimezone: string
    readonly sessionTimeBudgetMinutes: AthleteTrainingProfileV1['sessionTimeBudgetMinutes']
    readonly scheduleKind: 'full_body' | 'upper_lower'
    readonly strengthProgrammingStyle?: StrengthProgrammingStyleV1
    readonly strengthTemplate?: IntermediateUndulatingTemplateV1
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
  | {
    readonly kind: 'needs_template_adjustment'
    readonly reason: 'undulating_requires_intermediate_experience' | 'strength_template_unavailable'
    readonly missingMovementPatterns: readonly []
  }
)

function authoredProgressionDefaults(
  exercise: TrainingExerciseV1,
  catalog: TrainingCatalogV1,
): ExerciseProgressionDefaultsV1 | undefined {
  if (exercise.progressionDefaults) return exercise.progressionDefaults
  if (catalog.catalogVersion !== SYNTHETIC_STARTER_CATALOG.catalogVersion
    || catalog.origin.kind !== 'synthetic_fixture'
    || catalog.origin.fixtureHash !== SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH) return undefined
  return SYNTHETIC_STARTER_PROGRESSION_DEFAULTS[
    exercise.exerciseVersionId as keyof typeof SYNTHETIC_STARTER_PROGRESSION_DEFAULTS
  ]
}

function isSelectableExercise(exercise: TrainingExerciseV1, catalog: TrainingCatalogV1): boolean {
  if (exercise.lifecycle !== 'active' || !authoredProgressionDefaults(exercise, catalog)) return false
  if (catalog.origin.kind === 'synthetic_fixture') {
    return exercise.contentReviewStatus === 'reviewed_fixture'
      && (exercise.mediaStatus === 'reviewed_static_fixture'
        || (exercise.mediaStatus === 'missing' && typeof exercise.textInstruction === 'string'))
  }
  return exercise.contentReviewStatus === 'reviewed' && exercise.mediaStatus === 'reviewed_exact_variant'
}

function isSelectableConditioning(mode: ConditioningModeV1, catalog: TrainingCatalogV1): boolean {
  if (mode.lifecycle !== 'active') return false
  return catalog.origin.kind === 'synthetic_fixture'
    ? mode.contentReviewStatus === 'reviewed_fixture'
    : mode.contentReviewStatus === 'reviewed'
}

function implementSemantics(basis: EquipmentLoadBasis): Pick<SelectedExercise, 'implementCount' | 'holdingConfiguration'> {
  if (basis === 'dumbbell_per_hand') return { implementCount: 2, holdingConfiguration: 'one_per_hand' }
  if (basis === 'dumbbell_single_implement') return { implementCount: 1, holdingConfiguration: 'two_hands_single_implement' }
  if (basis === 'barbell_total') return { implementCount: 1, holdingConfiguration: 'both_hands_barbell' }
  if (basis === 'machine_stack') return { implementCount: 1, holdingConfiguration: 'machine_defined' }
  if (basis === 'bodyweight_external') return { implementCount: 0, holdingConfiguration: 'bodyweight_plus_external_load' }
  return { implementCount: 1, holdingConfiguration: 'machine_assistance' }
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
    const progressionDefaults = authoredProgressionDefaults(exercise, catalog)
    if (!progressionDefaults) continue
    for (const option of exercise.equipmentCompatibility) {
      for (const equipment of sortedInventory) {
        if (option.kind !== equipment.kind) continue
        const availableLoads = enumerateEquipmentLoadsWithinBounds(equipment, option.basis, {
          minimumCanonicalKg: option.minimumCanonicalKg,
          maximumCanonicalKg: option.maximumCanonicalKg,
        })
        const warmupSets = (exercise.warmupSets ?? []).map(warmup => ({
          targetReps: warmup.targetReps,
          prescribedLoad: createLoadQuantity(warmup.load),
        }))
        const warmupsAvailable = warmupSets.every(warmup => availableLoads.some(load => (
          load.quantity.entered.unit === warmup.prescribedLoad.entered.unit
          && compareEnteredLoadQuantities(load.quantity.entered, warmup.prescribedLoad.entered) === 0
        )))
        if (availableLoads.length > 0 && warmupsAvailable) {
          return {
            exercise,
            equipmentId: equipment.equipmentId,
            basis: option.basis,
            ...implementSemantics(option.basis),
            ...('bodyweightAssistancePolicy' in option
              ? { bodyweightAssistancePolicy: option.bodyweightAssistancePolicy }
              : {}),
            minimumCanonicalKg: option.minimumCanonicalKg,
            maximumCanonicalKg: option.maximumCanonicalKg,
            progressionDefaults,
            warmupSets,
          }
        }
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

interface ExercisePrescription {
  readonly repRange: { readonly minimum: number; readonly maximum: number }
  readonly targetRir: { readonly minimum: 2; readonly maximum: 3 }
  readonly restSeconds: number
  readonly exposureType: string
  readonly progressionSeriesId: string
  readonly idNamespace: readonly unknown[]
}

function exercisePrescription(
  selection: SelectedExercise,
  profile: AthleteTrainingProfileV1,
  scheduleDays: readonly ScheduledStrengthDay[],
  weekIndex: number,
  sessionIndex: number,
  template: IntermediateUndulatingTemplateV1 | null,
): ExercisePrescription {
  const baseSeriesId = `strength-slot:${selection.exercise.movementPattern}`
  if (!template) {
    return {
      repRange: repRange(profile),
      targetRir: { minimum: 2, maximum: 3 },
      restSeconds: 120,
      exposureType: selection.progressionDefaults.exposureType,
      progressionSeriesId: baseSeriesId,
      idNamespace: [],
    }
  }
  const occurrenceIndex = movementOccurrenceIndex(
    scheduleDays,
    selection.exercise.movementPattern,
    weekIndex,
    sessionIndex,
  )
  const exposure = undulatingExposureForOccurrence(template, occurrenceIndex)
  return {
    repRange: exposure.repRange,
    targetRir: exposure.targetRir,
    restSeconds: exposure.restSeconds,
    exposureType: exposure.exposureType,
    progressionSeriesId: `${baseSeriesId}:${exposure.exposureType}`,
    idNamespace: [template, exposure.exposureType],
  }
}

function sessionDuration(
  sessionType: StrengthSessionType,
  selections: ReadonlyMap<MovementPatternV1, SelectedExercise>,
  profile: AthleteTrainingProfileV1,
  prescriptions?: ReadonlyMap<MovementPatternV1, ExercisePrescription>,
): number {
  const selected = patternsForSession(sessionType).map(pattern => ({
    selection: selections.get(pattern) as SelectedExercise,
    prescription: prescriptions?.get(pattern),
  }))
  const authoredWarmupSeconds = selected.reduce((total, selection) => (
    total + selection.selection.warmupSets.reduce((sum, warmup) => (
      sum + warmup.targetReps * selection.selection.exercise.secondsPerRep
    ), 0)
  ), 0)
  return estimateDynamicSessionDuration({
    exercises: selected.map(({ selection, prescription }) => ({
      sets: 2,
      repCeiling: prescription?.repRange.maximum ?? repRange(profile).maximum,
      restSeconds: prescription?.restSeconds ?? 120,
      secondsPerRep: selection.exercise.secondsPerRep,
    })),
    warmupSeconds: Math.max(300, authoredWarmupSeconds),
    cooldownSeconds: 120,
    preparationSeconds: selected.reduce((sum, { selection }) => sum + selection.exercise.preparationSeconds, 0),
    budgetMinutes: profile.sessionTimeBudgetMinutes,
  }).durationSeconds
}

function scheduledDate(
  cycleStartLocalDate: string,
  weekday: Weekday,
  weekIndex: number,
  cycleLengthWeeks: AthleteTrainingProfileV1['cycleLengthWeeks'],
): string {
  return expandLocalDates(cycleStartLocalDate, weekday, cycleLengthWeeks)[weekIndex]
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

function stableGeneratedId(prefix: 'sess' | 'bout' | 'ex' | 'set', parts: readonly unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
  return `${prefix}_${digest}`
}

function compileExercise(
  selection: SelectedExercise,
  profile: AthleteTrainingProfileV1,
  prescription: ExercisePrescription,
  programRevisionId: string,
  week: number,
  sessionOrdinal: number,
  executionContext: ExecutionContextV1,
): CompiledExerciseV1 {
  const exerciseInstanceId = stableGeneratedId('ex', [
    executionContext,
    programRevisionId,
    week,
    sessionOrdinal,
    selection.exercise.exerciseVersionId,
    ...prescription.idNamespace,
  ])
  return {
    exerciseInstanceId,
    exerciseVersionId: selection.exercise.exerciseVersionId,
    movementPattern: selection.exercise.movementPattern,
    equipmentId: selection.equipmentId,
    loadBasis: selection.basis,
    implementCount: selection.implementCount,
    holdingConfiguration: selection.holdingConfiguration,
    ...(selection.bodyweightAssistancePolicy
      ? { bodyweightAssistancePolicy: selection.bodyweightAssistancePolicy }
      : {}),
    ...(selection.warmupSets.length > 0 ? {
      warmupSets: selection.warmupSets.map((warmup, index) => ({
        setId: stableGeneratedId('set', [executionContext, exerciseInstanceId, 'warmup', index + 1]),
        targetReps: warmup.targetReps,
        prescribedLoad: warmup.prescribedLoad,
      })),
    } : {}),
    setIds: [1, 2].map(set => stableGeneratedId('set', [executionContext, exerciseInstanceId, set])),
    repRange: prescription.repRange,
    targetRir: prescription.targetRir,
    restSeconds: prescription.restSeconds,
    progression: {
      progressionSeriesId: prescription.progressionSeriesId,
      ...selection.progressionDefaults,
      exposureType: prescription.exposureType,
      loadEpoch: 1,
    },
    loadSelection: {
      status: 'requires_explicit_acceptance',
      familiarizationHistoryAvailable: profile.startingHistory.some(history => (
        history.exerciseVersionId === selection.exercise.exerciseVersionId
        && history.equipmentLoad.equipmentId === selection.equipmentId
        && history.equipmentLoad.basis === selection.basis
      )),
      minimumCanonicalKg: selection.minimumCanonicalKg,
      maximumCanonicalKg: selection.maximumCanonicalKg,
    },
  }
}

export function compileTrainingProgram(
  input: unknown,
  options: CompileTrainingProgramOptions = {},
): CompilationResultV1 {
  const parsed = compileInputSchema.safeParse(input)
  if (!parsed.success) throw new Error('Invalid compiler input')
  const { profile, catalog } = parsed.data
  const resultContext = { executionContext: parsed.data.executionContext } as const
  const style = StrengthProgrammingStyleV1Schema.safeParse(
    options.strengthProgrammingStyle ?? 'repeatable',
  )
  if (!style.success) throw new Error('Invalid strength programming style')

  // Validate the local calendar anchor without converting it to an athlete instant.
  try {
    expandLocalDates(parsed.data.cycleStartLocalDate, 'monday', 1)
  } catch {
    return deepFreeze({
      ...resultContext,
      kind: 'invalid_anchor_date', reason: 'invalid_local_cycle_start',
      requestedValue: parsed.data.cycleStartLocalDate,
    })
  }

  const schedule = resolveStrengthSchedule(profile.strengthDays)
  if (schedule.kind === 'adjustment_required') {
    return deepFreeze({
      ...resultContext,
      kind: 'schedule_adjustment_required',
      reason: 'nonconsecutive_schedule_required',
      requestedDays: schedule.requestedDays,
      alternatives: schedule.alternatives,
    })
  }

  if (style.data === 'intermediate_undulating' && profile.experience !== 'intermediate') {
    return deepFreeze({
      ...resultContext,
      kind: 'needs_template_adjustment',
      reason: 'undulating_requires_intermediate_experience',
      missingMovementPatterns: [],
    })
  }
  const strengthTemplate = style.data === 'intermediate_undulating'
    ? resolveIntermediateUndulatingTemplate(
      parsed.data.executionContext,
      options.strengthTemplateRegistry,
    )
    : null
  if (style.data === 'intermediate_undulating' && !strengthTemplate) {
    return deepFreeze({
      ...resultContext,
      kind: 'needs_template_adjustment',
      reason: 'strength_template_unavailable',
      missingMovementPatterns: [],
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
    return deepFreeze({ ...resultContext, kind: 'needs_template_adjustment', reason: 'required_movement_unavailable', missingMovementPatterns })
  }

  const conditioningMode = catalog.conditioningModes.find(mode => (
    mode.modalityId === parsed.data.conditioningModalityId && isSelectableConditioning(mode, catalog)
  ))
  if (!conditioningMode) {
    return deepFreeze({ ...resultContext, kind: 'needs_template_adjustment', reason: 'conditioning_modality_unavailable', missingMovementPatterns: [] })
  }

  const phases = CYCLE_PHASES[profile.cycleLengthWeeks]
  const prescriptionsForSession = (weekIndex: number, sessionIndex: number) => new Map(
    patternsForSession(schedule.days[sessionIndex].sessionType).map(pattern => {
      const selection = selections.get(pattern) as SelectedExercise
      return [pattern, exercisePrescription(
        selection,
        profile,
        schedule.days,
        weekIndex,
        sessionIndex,
        strengthTemplate,
      )] as const
    }),
  )
  const requiredDurationSeconds = Math.max(...phases.flatMap((_, weekIndex) => (
    schedule.days.map((day, sessionIndex) => sessionDuration(
      day.sessionType,
      selections,
      profile,
      strengthTemplate ? prescriptionsForSession(weekIndex, sessionIndex) : undefined,
    ))
  )))
  if (requiredDurationSeconds > profile.sessionTimeBudgetMinutes * 60) {
    const feasibleBudgetMinutes = ([45, 60] as const).find(minutes => (
      minutes > profile.sessionTimeBudgetMinutes && requiredDurationSeconds <= minutes * 60
    )) ?? null
    return deepFreeze({
      ...resultContext,
      kind: 'time_budget_insufficient',
      reason: 'required_session_does_not_fit',
      requestedBudgetMinutes: profile.sessionTimeBudgetMinutes,
      requiredDurationSeconds,
      feasibleBudgetMinutes,
    })
  }

  const offDays = conditioningDays(schedule.days)
  const weeks: CompiledWeekV1[] = phases.map((phase, weekIndex) => {
    const week = weekIndex + 1
    const strengthSessions = schedule.days.map((day, sessionIndex): CompiledStrengthSessionV1 => {
      const prescriptions = prescriptionsForSession(weekIndex, sessionIndex)
      return {
        sessionId: stableGeneratedId('sess', [
          parsed.data.executionContext,
          parsed.data.programRevisionId,
          week,
          sessionIndex + 1,
          day.weekday,
          ...(strengthTemplate ? [strengthTemplate] : []),
        ]),
        sessionType: day.sessionType,
        weekday: day.weekday,
        scheduledLocalDate: scheduledDate(
          parsed.data.cycleStartLocalDate,
          day.weekday,
          weekIndex,
          profile.cycleLengthWeeks,
        ),
        athleteTimezone: profile.localTimezone,
        estimatedDurationSeconds: sessionDuration(
          day.sessionType,
          selections,
          profile,
          strengthTemplate ? prescriptions : undefined,
        ),
        warmupSeconds: Math.max(300, patternsForSession(day.sessionType).reduce((total, pattern) => {
          const selection = selections.get(pattern) as SelectedExercise
          return total + selection.warmupSets.reduce((sum, warmup) => (
            sum + warmup.targetReps * selection.exercise.secondsPerRep
          ), 0)
        }, 0)),
        cooldownSeconds: 120,
        exercises: patternsForSession(day.sessionType).map(pattern => compileExercise(
          selections.get(pattern) as SelectedExercise,
          profile,
          prescriptions.get(pattern) as ExercisePrescription,
          parsed.data.programRevisionId,
          week,
          sessionIndex + 1,
          parsed.data.executionContext,
        )),
      }
    })
    const conditioningBouts = offDays.map((weekday, boutIndex): CompiledConditioningBoutV1 => ({
      boutId: stableGeneratedId('bout', [parsed.data.executionContext, parsed.data.programRevisionId, week, boutIndex + 1, weekday]),
      modalityId: conditioningMode.modalityId,
      weekday,
      scheduledLocalDate: scheduledDate(
        parsed.data.cycleStartLocalDate,
        weekday,
        weekIndex,
        profile.cycleLengthWeeks,
      ),
      athleteTimezone: profile.localTimezone,
      durationOfferSeconds: 600,
      allowedDurationSeconds: { minimum: 60, maximum: 1_200 },
      effortCue: conditioningMode.effortCue,
      status: 'requires_explicit_acceptance',
    }))
    return { week, phase, strengthSessions, conditioningBouts }
  })

  return deepFreeze({
    ...resultContext,
    kind: 'draft_program',
    schemaVersion: COMPILED_PROGRAM_SCHEMA_VERSION,
    compilerPolicyVersion: PROGRAM_COMPILER_POLICY_VERSION,
    status: 'requires_explicit_acceptance',
    subjectId: parsed.data.subjectId,
    profileRevisionId: parsed.data.profileRevisionId,
    programRevisionId: parsed.data.programRevisionId,
    catalogVersion: catalog.catalogVersion,
    catalogOrigin: catalog.origin,
    goal: profile.goal,
    cycleLengthWeeks: profile.cycleLengthWeeks,
    cycleStartLocalDate: parsed.data.cycleStartLocalDate,
    athleteTimezone: profile.localTimezone,
    sessionTimeBudgetMinutes: profile.sessionTimeBudgetMinutes,
    scheduleKind: schedule.scheduleKind,
    ...(strengthTemplate
      ? { strengthProgrammingStyle: 'intermediate_undulating' as const, strengthTemplate }
      : {}),
    weeks,
  })
}

/** @deprecated Use compileTrainingProgram. Retained while persistence callers migrate. */
export function compileEightWeekProgram(
  input: unknown,
  options?: CompileTrainingProgramOptions,
): CompilationResultV1 {
  return compileTrainingProgram(input, options)
}
