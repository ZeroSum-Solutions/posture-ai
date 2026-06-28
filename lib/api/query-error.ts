// PostgREST returns this code when `.single()` matches zero (or multiple)
// rows. It is the ONLY error that genuinely means "not found" — every other
// code (missing column, undefined table, connection failure, RLS denial) is a
// real server error that must NOT be masked as a 404, or it hides outages and
// schema drift behind a misleading "not found" response.
export const NO_ROWS_CODE = 'PGRST116'

export function isNoRows(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === NO_ROWS_CODE
}
