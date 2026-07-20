/**
 * Coerce a PostgREST value to a number. Postgres NUMERIC columns (severity_pct,
 * deviation) are serialized as JSON strings, but the client types them as `number`
 * — calling `.toFixed()` on the raw string throws, and `<`/`>` compare them
 * lexicographically. Coerce at the ingestion boundary so all downstream math,
 * ordering, and formatting operate on real numbers. null/undefined stay null.
 */
export function toNum(v: number | string | null | undefined): number | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  const parsed = Number(v)
  return Number.isFinite(parsed) ? parsed : null
}
