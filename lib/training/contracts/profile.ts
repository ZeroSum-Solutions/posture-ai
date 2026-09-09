import { z } from 'zod'
import { createLoadQuantity, type LoadUnit } from '../quantity'
import type { EquipmentInventory } from '../equipment'
import { StrengthProgrammingStyleV1Schema } from '../engine/strengthTemplate'

export const ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION = 'athlete-training-profile.v1' as const
export const CONDITIONING_PREFERENCE_SCHEMA_VERSION = 'conditioning-preference.v1' as const

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const visibleSyntheticLabelSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .refine(label => /synthetic/i.test(label), 'Synthetic fixtures require a visible synthetic label')

const isoDateTimeSchema = z.string().datetime({ offset: true })
const loadUnitValues = ['kg', 'lb'] as const satisfies readonly LoadUnit[]
const loadUnitSchema = z.enum(loadUnitValues)

function isCanonicalKgAtMost1000(value: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return false
  const [whole, fraction = ''] = value.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
  if (normalizedWhole.length < 4) return true
  if (normalizedWhole.length > 4 || normalizedWhole > '1000') return false
  return normalizedWhole < '1000' || !/[1-9]/.test(fraction)
}

function addExactLoadIssue(
  value: string,
  unit: LoadUnit,
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  try {
    const quantity = createLoadQuantity({ value, unit })
    if (!isCanonicalKgAtMost1000(quantity.canonicalKg)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Load exceeds the 1000 kg profile bound',
        path,
      })
    }
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Load must be an exact unsigned kg/lb decimal with at most three fractional digits',
      path,
    })
  }
}

const exactLoadQuantitySchema = z.object({
  entered: z.object({
    value: z.string().max(16),
    unit: loadUnitSchema,
  }).strict(),
  canonicalKg: z.string().max(64),
}).strict().superRefine((quantity, ctx) => {
  try {
    const reconstructed = createLoadQuantity(quantity.entered)
    if (reconstructed.canonicalKg !== quantity.canonicalKg) {
      ctx.addIssue({
        code: 'custom',
        message: 'Canonical kilograms do not match the preserved entry',
        path: ['canonicalKg'],
      })
    }
    if (!isCanonicalKgAtMost1000(reconstructed.canonicalKg)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Load exceeds the 1000 kg profile bound',
        path: ['canonicalKg'],
      })
    }
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid exact load quantity',
      path: ['entered'],
    })
  }
})

const inventoryBaseShape = {
  equipmentId: stableIdSchema,
  unit: loadUnitSchema,
}

const barbellInventorySchema = z.object({
  kind: z.literal('barbell'),
  ...inventoryBaseShape,
  barWeight: z.string().max(16),
  collarsTotalWeight: z.string().max(16),
  plates: z.array(z.object({
    value: z.string().max(16),
    count: z.number().int().min(0).max(1000),
  }).strict()).max(1000),
}).strict().superRefine((inventory, ctx) => {
  addExactLoadIssue(inventory.barWeight, inventory.unit, ctx, ['barWeight'])
  addExactLoadIssue(inventory.collarsTotalWeight, inventory.unit, ctx, ['collarsTotalWeight'])
  inventory.plates.forEach((plate, index) => {
    addExactLoadIssue(plate.value, inventory.unit, ctx, ['plates', index, 'value'])
    if (plate.value === '0' || /^0+(?:\.0+)?$/.test(plate.value)) {
      ctx.addIssue({ code: 'custom', message: 'Plate value must be greater than zero', path: ['plates', index, 'value'] })
    }
  })
})

const dumbbellInventorySchema = z.object({
  kind: z.literal('dumbbell'),
  ...inventoryBaseShape,
  perHandLoads: z.array(z.string().max(16)).max(1000),
}).strict().superRefine((inventory, ctx) => {
  inventory.perHandLoads.forEach((value, index) => {
    addExactLoadIssue(value, inventory.unit, ctx, ['perHandLoads', index])
  })
})

const machineInventorySchema = z.object({
  kind: z.literal('machine'),
  ...inventoryBaseShape,
  stackLoads: z.array(z.string().max(16)).max(1000),
}).strict().superRefine((inventory, ctx) => {
  inventory.stackLoads.forEach((value, index) => {
    addExactLoadIssue(value, inventory.unit, ctx, ['stackLoads', index])
  })
})

const bodyweightExternalInventorySchema = z.object({
  kind: z.literal('bodyweight_external'),
  ...inventoryBaseShape,
  externalLoads: z.array(z.string().max(16)).max(1000),
}).strict().superRefine((inventory, ctx) => {
  inventory.externalLoads.forEach((value, index) => {
    addExactLoadIssue(value, inventory.unit, ctx, ['externalLoads', index])
  })
})

const assistanceMachineInventorySchema = z.object({
  kind: z.literal('assistance_machine'),
  ...inventoryBaseShape,
  assistanceLoads: z.array(z.string().max(16)).max(1000),
}).strict().superRefine((inventory, ctx) => {
  inventory.assistanceLoads.forEach((value, index) => {
    addExactLoadIssue(value, inventory.unit, ctx, ['assistanceLoads', index])
  })
})

export const EquipmentInventoryV1Schema: z.ZodType<EquipmentInventory> = z.discriminatedUnion('kind', [
  barbellInventorySchema,
  dumbbellInventorySchema,
  machineInventorySchema,
  bodyweightExternalInventorySchema,
  assistanceMachineInventorySchema,
])

const equipmentLoadSchema = z.object({
  equipmentId: stableIdSchema,
  basis: z.enum([
    'barbell_total',
    'dumbbell_per_hand',
    'dumbbell_single_implement',
    'machine_stack',
    'bodyweight_external',
    'machine_assistance',
  ]),
  quantity: exactLoadQuantitySchema,
}).strict()

const historySourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('recalled'),
    sourceVersion: z.literal('athlete-recall.v1'),
    capturedAt: isoDateTimeSchema,
  }).strict(),
  z.object({
    kind: z.literal('imported'),
    sourceVersion: z.literal('external-history-import.v1'),
    sourceSystemId: stableIdSchema,
    sourceRecordReference: stableIdSchema,
    importedAt: isoDateTimeSchema,
  }).strict(),
])

export const StartingHistoryEntryV1Schema = z.object({
  exerciseVersionId: stableIdSchema,
  performedAt: isoDateTimeSchema.nullable(),
  equipmentLoad: equipmentLoadSchema,
  reps: z.number().int().min(1).max(100),
  source: historySourceSchema,
  progressionEvidenceEligible: z.literal(false),
}).strict()

const profileOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('athlete_input') }).strict(),
  z.object({
    kind: z.literal('synthetic_fixture'),
    fixtureId: stableIdSchema,
    label: visibleSyntheticLabelSchema,
  }).strict(),
])

const weekdaySchema = z.enum([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])

export const ConditioningPreferenceV1Schema = z.object({
  schemaVersion: z.literal(CONDITIONING_PREFERENCE_SCHEMA_VERSION),
  catalogVersion: stableIdSchema,
  preferredModalityIds: z.array(stableIdSchema).min(1).max(8),
}).strict().superRefine((preference, ctx) => {
  if (new Set(preference.preferredModalityIds).size !== preference.preferredModalityIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Preferred conditioning modality IDs must be unique', path: ['preferredModalityIds'] })
  }
})

function isIanaTimezone(value: string): boolean {
  if (!value.includes('/') && value !== 'UTC') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const AthleteTrainingProfileV1Schema = z.object({
  schemaVersion: z.literal(ATHLETE_TRAINING_PROFILE_SCHEMA_VERSION),
  origin: profileOriginSchema,
  goal: z.enum(['strength', 'general_fitness']),
  experience: z.enum(['new_to_strength', 'beginner', 'intermediate']),
  strengthProgrammingStyle: StrengthProgrammingStyleV1Schema.optional(),
  conditioningPreference: ConditioningPreferenceV1Schema.optional(),
  recentConsistency: z.enum(['none', 'intermittent', 'consistent', 'unknown']),
  cycleLengthWeeks: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
  strengthDays: z.array(weekdaySchema).min(2).max(4),
  localTimezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, 'A valid IANA timezone is required'),
  sessionTimeBudgetMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  preferredLoadUnit: loadUnitSchema,
  equipmentInventory: z.array(EquipmentInventoryV1Schema).max(1000),
  startingHistory: z.array(StartingHistoryEntryV1Schema).max(50),
}).strict().superRefine((profile, ctx) => {
  if (profile.strengthProgrammingStyle === 'intermediate_undulating'
    && profile.experience !== 'intermediate') {
    ctx.addIssue({
      code: 'custom',
      message: 'Intermediate undulating programming requires intermediate experience',
      path: ['strengthProgrammingStyle'],
    })
  }
  if (new Set(profile.strengthDays).size !== profile.strengthDays.length) {
    ctx.addIssue({ code: 'custom', message: 'Strength days must be unique', path: ['strengthDays'] })
  }

  const inventoryById = new Map<string, EquipmentInventory>()
  profile.equipmentInventory.forEach((inventory, index) => {
    if (inventoryById.has(inventory.equipmentId)) {
      ctx.addIssue({ code: 'custom', message: 'Equipment IDs must be unique', path: ['equipmentInventory', index, 'equipmentId'] })
    }
    inventoryById.set(inventory.equipmentId, inventory)
  })

  profile.startingHistory.forEach((entry, index) => {
    const inventory = inventoryById.get(entry.equipmentLoad.equipmentId)
    if (!inventory) {
      ctx.addIssue({ code: 'custom', message: 'Starting history must reference available equipment', path: ['startingHistory', index, 'equipmentLoad', 'equipmentId'] })
      return
    }
    const allowedBases = inventory.kind === 'barbell'
      ? ['barbell_total']
      : inventory.kind === 'dumbbell'
        ? ['dumbbell_per_hand', 'dumbbell_single_implement']
        : inventory.kind === 'machine'
          ? ['machine_stack']
          : inventory.kind === 'bodyweight_external'
            ? ['bodyweight_external']
            : ['machine_assistance']
    if (!allowedBases.includes(entry.equipmentLoad.basis)) {
      ctx.addIssue({ code: 'custom', message: 'History load basis does not match equipment', path: ['startingHistory', index, 'equipmentLoad', 'basis'] })
    }
    if (entry.equipmentLoad.quantity.entered.unit !== inventory.unit) {
      ctx.addIssue({ code: 'custom', message: 'History load unit does not match equipment', path: ['startingHistory', index, 'equipmentLoad', 'quantity', 'entered', 'unit'] })
    }
  })
})

export type EquipmentInventoryV1 = z.infer<typeof EquipmentInventoryV1Schema>
export type StartingHistoryEntryV1 = z.infer<typeof StartingHistoryEntryV1Schema>
export type ConditioningPreferenceV1 = z.infer<typeof ConditioningPreferenceV1Schema>
export type AthleteTrainingProfileV1 = z.infer<typeof AthleteTrainingProfileV1Schema>
