import { NextResponse } from 'next/server'

export const CLINICAL_CONTENT_NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export function clinicalContentUnavailableResponse(publicSurface = false): NextResponse {
  return NextResponse.json(
    {
      error: publicSurface
        ? 'This content is not available.'
        : 'Clinical recommendations are not enabled for this release.',
      code: 'clinical_content_disabled',
    },
    {
      status: 404,
      headers: publicSurface
        ? { 'Cache-Control': 'no-store, max-age=0' }
        : CLINICAL_CONTENT_NO_STORE,
    },
  )
}
