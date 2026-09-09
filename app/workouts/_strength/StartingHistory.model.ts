import {
  StartingHistoryEntryV1Schema,
  type StartingHistoryEntryV1,
} from '@/lib/training/contracts/profile'
import { createLoadQuantity, type LoadUnit } from '@/lib/training/quantity'
import type { EquipmentLoadBasis } from '@/lib/training/equipment'

export type StartingHistoryExerciseOption = {
  exerciseVersionId: string
  label: string
  equipmentOptions: readonly { equipmentId: string; basis: EquipmentLoadBasis; unit: LoadUnit }[]
}

export function createRecalledStartingSet(input: {
  options: readonly StartingHistoryExerciseOption[]
  exerciseVersionId: string
  equipmentId: string
  basis: EquipmentLoadBasis
  load: string
  reps: string
  performedAt: string | null
  capturedAt: string
}): StartingHistoryEntryV1 {
  const exercises = input.options.filter(option => option.exerciseVersionId === input.exerciseVersionId)
  if (exercises.length !== 1) throw new Error('Choose an exercise from the current program catalog.')
  const equipment = exercises[0].equipmentOptions.filter(option => (
    option.equipmentId === input.equipmentId && option.basis === input.basis
  ))
  if (equipment.length !== 1) throw new Error('Choose compatible equipment for this exercise.')
  if (!/^\d+$/.test(input.reps) || Number(input.reps) < 1 || Number(input.reps) > 100) {
    throw new Error('Enter a whole number of repetitions from 1 to 100.')
  }
  const entry = StartingHistoryEntryV1Schema.parse({
    exerciseVersionId: input.exerciseVersionId,
    equipmentLoad: {
      equipmentId: equipment[0].equipmentId,
      basis: equipment[0].basis,
      quantity: createLoadQuantity({ value: input.load, unit: equipment[0].unit }),
    },
    reps: Number(input.reps),
    performedAt: input.performedAt,
    source: { kind: 'recalled', sourceVersion: 'athlete-recall.v1', capturedAt: input.capturedAt },
    progressionEvidenceEligible: false,
  })
  if (entry.performedAt && Date.parse(entry.performedAt) > Date.parse(input.capturedAt)) {
    throw new Error('A recalled set cannot be dated in the future.')
  }
  return entry
}
