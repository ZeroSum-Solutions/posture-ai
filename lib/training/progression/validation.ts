import { z } from 'zod'
import { EligibilitySnapshotV1Schema } from '../contracts/eligibility'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '../quantity'
import type { StrengthProgressionInputV1 } from './types'

const MAX_EVIDENCE_EXPOSURES = 1_000
const MAX_SETS_PER_EXPOSURE = 100
const MAX_INVENTORY_ENTRIES = 1_000

const nonemptyString = z.string().refine(value => value.trim().length > 0)
const utcTimestamp = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'))
const loadUnit = z.enum(['kg', 'lb'])
const loadBasis = z.enum(['barbell_total', 'dumbbell_per_hand', 'machine_stack'])

const enteredQuantity = z.strictObject({
  value: z.string(),
  unit: loadUnit,
})

const exactLoadQuantity = z.strictObject({
  entered: enteredQuantity,
  canonicalKg: z.string(),
}).superRefine((quantity, context) => {
  try {
    const recreated = createLoadQuantity(quantity.entered)
    if (recreated.canonicalKg !== quantity.canonicalKg) {
      context.addIssue({ code: 'custom', message: 'Load quantity is not canonical' })
    }
    if (!isEnteredLoadAtMostCanonicalKg(quantity.entered, '1000')) {
      context.addIssue({ code: 'custom', message: 'Load quantity exceeds 1000 kg' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Load quantity is invalid' })
  }
})

const equipmentLoad = z.strictObject({
  equipmentId: nonemptyString,
  basis: loadBasis,
  quantity: exactLoadQuantity,
})

function decimalValuesAreValid(values: readonly string[], unit: 'kg' | 'lb'): boolean {
  return values.every(value => {
    try {
      return isEnteredLoadAtMostCanonicalKg({ value, unit }, '1000')
    } catch {
      return false
    }
  })
}

const barbellInventory = z.strictObject({
  kind: z.literal('barbell'),
  equipmentId: nonemptyString,
  unit: loadUnit,
  barWeight: z.string(),
  collarsTotalWeight: z.string(),
  plates: z.array(z.strictObject({
    value: z.string(),
    count: z.number().int().min(0).max(1_000),
  })).max(MAX_INVENTORY_ENTRIES),
}).superRefine((inventory, context) => {
  const values = [inventory.barWeight, inventory.collarsTotalWeight, ...inventory.plates.map(plate => plate.value)]
  if (!decimalValuesAreValid(values, inventory.unit)) {
    context.addIssue({ code: 'custom', message: 'Barbell inventory contains an invalid load' })
    return
  }
  if (inventory.plates.some(plate => createLoadQuantity({ value: plate.value, unit: inventory.unit }).canonicalKg === '0')) {
    context.addIssue({ code: 'custom', message: 'Barbell plate values must be greater than zero' })
  }
})

const dumbbellInventory = z.strictObject({
  kind: z.literal('dumbbell'),
  equipmentId: nonemptyString,
  unit: loadUnit,
  perHandLoads: z.array(z.string()).max(MAX_INVENTORY_ENTRIES),
}).superRefine((inventory, context) => {
  if (!decimalValuesAreValid(inventory.perHandLoads, inventory.unit)) {
    context.addIssue({ code: 'custom', message: 'Dumbbell inventory contains an invalid load' })
  }
})

const machineInventory = z.strictObject({
  kind: z.literal('machine'),
  equipmentId: nonemptyString,
  unit: loadUnit,
  stackLoads: z.array(z.string()).max(MAX_INVENTORY_ENTRIES),
}).superRefine((inventory, context) => {
  if (!decimalValuesAreValid(inventory.stackLoads, inventory.unit)) {
    context.addIssue({ code: 'custom', message: 'Machine inventory contains an invalid load' })
  }
})

const equipmentInventory = z.discriminatedUnion('kind', [barbellInventory, dumbbellInventory, machineInventory])

const repRange = z.strictObject({
  min: z.number().int().min(1).max(100),
  max: z.number().int().min(1).max(100),
}).refine(range => range.min <= range.max)

const rirRange = z.strictObject({
  min: z.number().int().min(0).max(5),
  max: z.number().int().min(0).max(5),
}).refine(range => range.min <= range.max)

const comparatorFields = {
  exerciseVersionId: nonemptyString,
  equipmentId: nonemptyString,
  loadBasis,
  side: nonemptyString,
  rom: nonemptyString,
  tempo: nonemptyString,
  prescribedWorkingSets: z.number().int().min(1).max(MAX_SETS_PER_EXPOSURE),
  repRange,
  targetRir: rirRange,
  exposureType: nonemptyString,
  loadEpoch: z.number().int().min(0),
}

const comparator = z.strictObject({
  subjectId: nonemptyString,
  ...comparatorFields,
})

const prescription = z.strictObject({
  prescriptionId: nonemptyString,
  prescribedLoad: equipmentLoad,
  ...comparatorFields,
})

const actualSet = z.strictObject({
  setId: nonemptyString,
  ordinal: z.number().int().min(1).max(MAX_SETS_PER_EXPOSURE),
  kind: z.enum(['working', 'warmup', 'extra']),
  actualReps: z.number().int().min(0).max(100),
  actualRir: z.union([z.number().int().min(0).max(5), z.enum(['6_plus', 'unknown'])]),
  load: equipmentLoad,
  symptom: z.enum(['none', 'adverse']),
  validity: z.enum(['valid', 'invalid']),
})

const outlierAcknowledgement = z.strictObject({
  sourceRevisionId: nonemptyString,
  priorExposureRevisionId: nonemptyString,
  actualExposureRevisionId: nonemptyString,
})

const exposure = z.strictObject({
  sourceRevisionId: nonemptyString,
  provenance: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('in_app'), sourceVersion: z.literal('training-log.v1') }),
    z.strictObject({ kind: z.literal('recalled'), sourceVersion: z.literal('athlete-recall.v1') }),
    z.strictObject({ kind: z.literal('imported'), sourceVersion: z.literal('external-history-import.v1') }),
  ]),
  acceptedPrescription: z.strictObject({
    sourceRevisionId: nonemptyString,
    load: equipmentLoad,
  }),
  sessionState: z.enum(['completed', 'completed_with_omissions', 'in_progress', 'aborted']),
  exerciseState: z.enum(['completed', 'incomplete', 'omitted', 'aborted']),
  syncState: z.enum(['acknowledged', 'pending', 'conflicted']),
  startedAt: utcTimestamp,
  completedAt: utcTimestamp.nullable(),
  omittedExerciseInstanceIds: z.array(nonemptyString).max(MAX_SETS_PER_EXPOSURE),
  outlierAcknowledgement: outlierAcknowledgement.optional(),
  comparator,
  sets: z.array(actualSet).max(MAX_SETS_PER_EXPOSURE),
})

const eligibilityAuthorization = z.strictObject({
  decision: z.enum(['authorized', 'blocked']),
  subjectId: nonemptyString,
  exerciseVersionId: nonemptyString,
  programRevisionId: nonemptyString,
  policyVersion: nonemptyString,
  sourceRevisionId: nonemptyString,
  effectiveFrom: utcTimestamp,
  effectiveUntil: utcTimestamp,
})

export const strengthProgressionInputV1Schema = z.strictObject({
  policyVersion: z.literal('strength-progression-v1'),
  now: utcTimestamp,
  subjectId: nonemptyString,
  sourceProfileRevisionId: nonemptyString,
  programRevisionId: nonemptyString,
  eligibility: EligibilitySnapshotV1Schema,
  eligibilityAuthorization: eligibilityAuthorization.optional(),
  prescription,
  equipmentInventory,
  exposures: z.array(exposure).max(MAX_EVIDENCE_EXPOSURES),
}).superRefine((input, context) => {
  const now = Date.parse(input.now)
  input.exposures.forEach((item, index) => {
    const startedAt = Date.parse(item.startedAt)
    const completedAt = item.completedAt === null ? null : Date.parse(item.completedAt)
    if (startedAt > now) {
      context.addIssue({ code: 'custom', path: ['exposures', index, 'startedAt'], message: 'Exposure cannot start in the future' })
    }
    if (completedAt !== null && completedAt > now) {
      context.addIssue({ code: 'custom', path: ['exposures', index, 'completedAt'], message: 'Exposure cannot complete in the future' })
    }
    if (completedAt !== null && completedAt < startedAt) {
      context.addIssue({ code: 'custom', path: ['exposures', index, 'completedAt'], message: 'Exposure completion cannot precede start' })
    }
  })
  if (input.prescription.equipmentId !== input.equipmentInventory.equipmentId) {
    context.addIssue({ code: 'custom', path: ['equipmentInventory', 'equipmentId'], message: 'Equipment ID does not match prescription' })
  }
  const expectedBasis = input.equipmentInventory.kind === 'barbell'
    ? 'barbell_total'
    : input.equipmentInventory.kind === 'dumbbell'
      ? 'dumbbell_per_hand'
      : 'machine_stack'
  if (input.prescription.loadBasis !== expectedBasis) {
    context.addIssue({ code: 'custom', path: ['prescription', 'loadBasis'], message: 'Load basis does not match equipment inventory' })
  }
  if (input.prescription.prescribedLoad.equipmentId !== input.prescription.equipmentId
    || input.prescription.prescribedLoad.basis !== input.prescription.loadBasis
    || input.prescription.prescribedLoad.quantity.entered.unit !== input.equipmentInventory.unit) {
    context.addIssue({ code: 'custom', path: ['prescription', 'prescribedLoad'], message: 'Prescribed load does not match prescription equipment' })
  }
})

export interface ProgressionValidationIssue {
  readonly path: string
  readonly code: string
}

export class ProgressionInputValidationError extends Error {
  readonly code = 'INVALID_STRENGTH_PROGRESSION_INPUT'
  readonly issues: readonly ProgressionValidationIssue[]

  constructor(issues: readonly ProgressionValidationIssue[]) {
    super('Invalid strength progression input')
    this.name = 'ProgressionInputValidationError'
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
  }
}

export function parseStrengthProgressionInputV1(input: unknown): StrengthProgressionInputV1 {
  const result = strengthProgressionInputV1Schema.safeParse(input)
  if (!result.success) {
    throw new ProgressionInputValidationError(result.error.issues.map(issue => ({
      path: issue.path.join('.'),
      code: issue.code,
    })))
  }
  return result.data as StrengthProgressionInputV1
}
