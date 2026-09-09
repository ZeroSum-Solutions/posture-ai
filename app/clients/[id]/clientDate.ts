const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export type ClientDateStyle =
  | 'day-month-short'
  | 'day-month-short-no-year'
  | 'day-month-long'
  | 'month-day-short'

/** Stable UTC copy for server-rendered client facts and comparison headings. */
export function formatClientDate(value: string, style: ClientDateStyle): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'

  const day = date.getUTCDate()
  const month = date.getUTCMonth()
  const year = date.getUTCFullYear()

  if (style === 'day-month-short-no-year') return `${day} ${MONTHS_SHORT[month]}`
  if (style === 'day-month-long') return `${day} ${MONTHS_LONG[month]} ${year}`
  if (style === 'month-day-short') return `${MONTHS_SHORT[month]} ${day}, ${year}`
  return `${day} ${MONTHS_SHORT[month]} ${year}`
}

/** Stable UTC 24-hour time for repeated-day assessment rows. */
export function formatClientTime(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
