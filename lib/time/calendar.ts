const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/** UTC calendar labels must be identical during server rendering and hydration.
 * ICU short-month spellings differ between Node and Safari (Sep versus Sept).
 */
export function utcCalendarLabel(value: string, style: 'short' | 'long' | 'numeric'): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'date unavailable'
  const day = date.getUTCDate()
  const month = date.getUTCMonth()
  const year = date.getUTCFullYear()
  if (style === 'numeric') return `${month + 1}/${day}/${year}`
  if (style === 'long') return `${MONTHS[month]} ${day}, ${year}`
  return `${day} ${MONTHS[month].slice(0, 3)}`
}
