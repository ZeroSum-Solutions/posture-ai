import type {
  CreateManualReferenceRoutineV1,
  ManualReferenceRoutineListV1,
  ManualReferenceRoutineV1,
} from '@/lib/training/contracts/manual-reference-routine'

export const MAX_MANUAL_ROUTINE_URL_EXERCISES = 24

export type ManualRoutinePageIdentity =
  | { kind: 'athlete'; subjectId: string; name: string }
  | { kind: 'practitioner'; clients: Array<{ id: string; name: string }> }
  | { kind: 'unavailable'; code: string }

export type ManualRoutineExerciseDisplay = {
  name: string
  instructions: string
  equipment: string[]
  media: null | {
    kind: 'image'
    posterUrl: string
    alt: string
    width: number
    height: number
    source: { assetUrl: string; author: string; license: { shortName: string; url: string }; modifications: 'none' }
  }
  source: { recordUrl: string; author: string; license: { shortName: string; url: string } }
}

export type ManualRoutineExerciseChoice = ManualRoutineExerciseDisplay & { id: string; category: string }
export type ManualRoutineWriteItem = CreateManualReferenceRoutineV1['items'][number]
export type ManualRoutineItem = ManualRoutineWriteItem & { exerciseDisplay: ManualRoutineExerciseDisplay }
export type ManualRoutine = ManualReferenceRoutineV1
export type ManualRoutineSummary = ManualReferenceRoutineListV1['routines'][number]
export type ManualRoutineListPage = {
  routines: ManualRoutineSummary[]
  hasMore: boolean
  nextCursor: string | null
}
export type ManualRoutineSaveInput = { title: string; items: ManualRoutineWriteItem[] }
