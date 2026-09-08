import { z } from 'zod'

export const WEEKDAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const

export type Weekday = typeof WEEKDAYS[number]
export type StrengthSessionType = 'full_body' | 'upper' | 'lower'

export interface ScheduledStrengthDay {
  readonly weekday: Weekday
  readonly sessionType: StrengthSessionType
}

export interface ScheduleAlternative {
  readonly preservedRequestedDays: number
  readonly movedSessions: number
  readonly days: readonly ScheduledStrengthDay[]
}

export type StrengthScheduleResolution =
  | { readonly kind: 'accepted'; readonly scheduleKind: 'full_body' | 'upper_lower'; readonly days: readonly ScheduledStrengthDay[] }
  | { readonly kind: 'adjustment_required'; readonly requestedDays: readonly Weekday[]; readonly alternatives: readonly ScheduleAlternative[] }

const weekdaySchema = z.enum(WEEKDAYS)
const scheduleInputSchema = z.array(weekdaySchema).min(2).max(4)

function dayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day)
}

function cyclicGap(left: number, right: number): number {
  return (right - left + 7) % 7
}

function isNonconsecutive(indices: readonly number[]): boolean {
  return indices.every((value, index) => {
    const next = indices[(index + 1) % indices.length]
    return cyclicGap(value, next) > 1
  })
}

function assignDays(days: readonly Weekday[]): ScheduledStrengthDay[] {
  const sorted = [...days].sort((left, right) => dayIndex(left) - dayIndex(right))
  if (sorted.length < 4) return sorted.map(weekday => ({ weekday, sessionType: 'full_body' as const }))
  return sorted.map((weekday, index) => ({ weekday, sessionType: index % 2 === 0 ? 'upper' as const : 'lower' as const }))
}

function isValid(days: readonly Weekday[]): boolean {
  const assigned = assignDays(days)
  if (assigned.length < 4) return isNonconsecutive(assigned.map(day => dayIndex(day.weekday)))
  for (const sessionType of ['upper', 'lower'] as const) {
    const indices = assigned.filter(day => day.sessionType === sessionType).map(day => dayIndex(day.weekday))
    if (!isNonconsecutive(indices)) return false
  }
  return true
}

function combinations<T>(values: readonly T[], size: number, start = 0, prefix: readonly T[] = []): T[][] {
  if (prefix.length === size) return [[...prefix]]
  const output: T[][] = []
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    output.push(...combinations(values, size, index + 1, [...prefix, values[index]]))
  }
  return output
}

export function resolveStrengthSchedule(input: unknown): StrengthScheduleResolution {
  const parsed = scheduleInputSchema.safeParse(input)
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) throw new Error('Invalid strength schedule')
  const requested = [...parsed.data].sort((left, right) => dayIndex(left) - dayIndex(right))
  const scheduleKind = requested.length === 4 ? 'upper_lower' as const : 'full_body' as const
  if (isValid(requested)) return Object.freeze({ kind: 'accepted', scheduleKind, days: assignDays(requested) })

  const requestedSet = new Set(requested)
  const alternatives = combinations(WEEKDAYS, requested.length)
    .filter(isValid)
    .map((days) => {
      const preservedRequestedDays = days.filter(day => requestedSet.has(day)).length
      return {
        preservedRequestedDays,
        movedSessions: requested.length - preservedRequestedDays,
        days: assignDays(days),
      }
    })
    .sort((left, right) => (
      right.preservedRequestedDays - left.preservedRequestedDays
      || left.movedSessions - right.movedSessions
      || left.days.map(day => dayIndex(day.weekday)).join('').localeCompare(right.days.map(day => dayIndex(day.weekday)).join(''))
    ))

  return Object.freeze({
    kind: 'adjustment_required',
    requestedDays: requested,
    alternatives,
  })
}

const isoLocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function parseLocalDate(value: string): Date {
  if (!isoLocalDateSchema.safeParse(value).success) throw new Error('Invalid local date')
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('Invalid local date')
  }
  return parsed
}

function formatLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function expandLocalDates(cycleStartLocalDate: string, weekday: Weekday, weekCount: number): string[] {
  const start = parseLocalDate(cycleStartLocalDate)
  const parsedWeekday = weekdaySchema.safeParse(weekday)
  if (!parsedWeekday.success) throw new Error('Invalid weekday')
  if (!Number.isInteger(weekCount) || weekCount < 1 || weekCount > 52) throw new Error('Invalid week count')
  const jsDay = start.getUTCDay()
  const mondayBasedStart = (jsDay + 6) % 7
  // The anchor starts a seven-day local-calendar window. A requested weekday
  // resolves to its first occurrence on or after that anchor.
  const firstOffset = (dayIndex(parsedWeekday.data) - mondayBasedStart + 7) % 7
  return Array.from({ length: weekCount }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + firstOffset + index * 7)
    return formatLocalDate(date)
  })
}
