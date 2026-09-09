import type { MovementPatternV1 } from '../catalog/types'
import type { ScheduledStrengthDay } from './schedule'
import type {
  IntermediateUndulatingTemplateV1,
  StrengthExposurePrescriptionV1,
} from './strengthTemplate'

function patternsForSession(sessionType: ScheduledStrengthDay['sessionType']): readonly MovementPatternV1[] {
  if (sessionType === 'upper') return ['push', 'pull']
  if (sessionType === 'lower') return ['knee_dominant', 'hinge']
  return ['knee_dominant', 'hinge', 'push', 'pull']
}

/** Zero-based occurrence within one movement's own chronological track. */
export function movementOccurrenceIndex(
  days: readonly ScheduledStrengthDay[],
  movementPattern: MovementPatternV1,
  weekIndex: number,
  sessionIndex: number,
): number {
  if (!Number.isInteger(weekIndex) || weekIndex < 0
    || !Number.isInteger(sessionIndex) || sessionIndex < 0 || sessionIndex >= days.length) {
    throw new Error('Invalid movement occurrence position')
  }
  if (!patternsForSession(days[sessionIndex].sessionType).includes(movementPattern)) {
    throw new Error('Movement is not authored in this session')
  }
  const occurrencesPerWeek = days.filter(day => (
    patternsForSession(day.sessionType).includes(movementPattern)
  )).length
  const occurrencesBeforeSession = days.slice(0, sessionIndex).filter(day => (
    patternsForSession(day.sessionType).includes(movementPattern)
  )).length
  return weekIndex * occurrencesPerWeek + occurrencesBeforeSession
}

export function undulatingExposureForOccurrence(
  template: IntermediateUndulatingTemplateV1,
  occurrenceIndex: number,
): StrengthExposurePrescriptionV1 {
  if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
    throw new Error('Invalid movement occurrence index')
  }
  return occurrenceIndex % 2 === 0 ? template.heavy : template.volume
}

