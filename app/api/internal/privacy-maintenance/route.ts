import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { drainStorageDeletionOutbox } from '@/lib/privacy/storageDeletion'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function authorized(req: NextRequest, expected: string) {
  const presented = req.headers.get('authorization')
  if (!presented?.startsWith('Bearer ')) return false
  const left = Buffer.from(presented.slice(7))
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Privacy maintenance is not configured.' }, { status: 503, headers: NO_STORE })
  }
  if (!authorized(req, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const service = createSupabaseServiceClient()
  const { data: reconciliation, error: reconciliationError } = await service.rpc(
    'reconcile_legacy_client_erasures',
    { p_limit: 100 },
  )
  if (reconciliationError || !reconciliation) {
    return NextResponse.json({ error: 'Privacy maintenance did not complete.' }, { status: 500, headers: NO_STORE })
  }
  const storage = await drainStorageDeletionOutbox(service)
  const { data, error } = await service.rpc('run_approved_privacy_retention', {
    p_now: new Date().toISOString(),
  })
  if (storage.claimFailed || error || !data) {
    return NextResponse.json({ error: 'Privacy maintenance did not complete.' }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ reconciliation, storage, retention: data }, { headers: NO_STORE })
}
