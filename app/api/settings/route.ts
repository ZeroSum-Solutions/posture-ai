import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'

const patchSchema = z.object({
  display_name: z.string().trim().max(120).optional(),
  practice_name: z.string().trim().max(160).optional(),
}).strict()

export async function PATCH(req: NextRequest) {
  const ROUTE = 'PATCH /api/settings'
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, { route: 'settings_update', userId: user.id, limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid payload: ${parsed.error.issues[0]?.message ?? 'malformed'}` }, { status: 422 })
  }
  const { display_name, practice_name } = parsed.data

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (display_name !== undefined) updates.display_name = display_name
  if (practice_name !== undefined) updates.practice_name = practice_name

  const { data, error } = await supabase
    .from('practitioners')
    .update(updates)
    .eq('id', user.id)
    .select('display_name, practice_name, logo_storage_path')
    .single()

  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'settings_update_failed' })
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ practitioner: data })
}

// Raster images only, capped — the logo is re-served to the practitioner's own
// reports, so reject anything that isn't a small image outright.
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export async function POST(req: NextRequest) {
  // Logo upload endpoint
  const ROUTE = 'POST /api/settings'
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const serviceClient = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(serviceClient, { route: 'settings_logo', userId: user.id, limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  const formData = await req.formData()
  const file = formData.get('logo') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  const ext = LOGO_TYPES[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Logo must be a PNG, JPEG, or WebP image.' }, { status: 422 })
  }
  if (file.size > LOGO_MAX_BYTES) {
    return NextResponse.json({ error: 'Logo must be 2 MB or smaller.' }, { status: 413 })
  }

  // Read the previous pointer before creating a new object. A unique path keeps
  // the currently referenced logo intact until the metadata write succeeds;
  // overwriting `${user.id}/logo.ext` first made that update impossible to roll
  // back safely.
  const { data: currentPractitioner, error: currentPathError } = await supabase
    .from('practitioners')
    .select('logo_storage_path')
    .eq('id', user.id)
    .maybeSingle()
  if (currentPathError || !currentPractitioner) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'logo_path_load_failed' })
    return NextResponse.json({ error: 'Failed to upload logo.' }, { status: 500 })
  }

  const path = `${user.id}/logo-${randomUUID()}.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Ensure bucket exists
  await serviceClient.storage.createBucket('practitioner-assets', { public: false }).catch(() => {})

  const { error: uploadError } = await serviceClient.storage
    .from('practitioner-assets')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'logo_upload_failed' })
    return NextResponse.json({ error: 'Failed to upload logo.' }, { status: 500 })
  }

  // Update practitioners table with logo path — checked: an unchecked failure
  // here means the logo "uploads" but vanishes on the next page load.
  const { error: pathErr } = await supabase
    .from('practitioners')
    .update({ logo_storage_path: path, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('logo_storage_path')
    .single()
  if (pathErr) {
    // The new object is not referenced unless the metadata write commits. Remove
    // it on failure so retries cannot accumulate practitioner-owned orphans.
    const { error: cleanupError } = await serviceClient.storage
      .from('practitioner-assets')
      .remove([path])
    if (cleanupError) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'logo_rollback_failed' })
    }
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'logo_path_save_failed' })
    return NextResponse.json({ error: 'Failed to save logo.' }, { status: 500 })
  }

  // Once the new pointer is durable, the previous practitioner-owned object is
  // no longer reachable. Its cleanup is best-effort because deleting it must not
  // roll back a successful replacement, and a corrupt cross-tenant path must
  // never be honored by the service-role client.
  const previousPath = currentPractitioner.logo_storage_path
  if (previousPath && previousPath !== path && previousPath.startsWith(`${user.id}/`)) {
    const { error: cleanupError } = await serviceClient.storage
      .from('practitioner-assets')
      .remove([previousPath])
    if (cleanupError) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'previous_logo_cleanup_failed' })
    }
  }

  // Return signed URL
  const { data: signedData } = await serviceClient.storage
    .from('practitioner-assets')
    .createSignedUrl(path, 3600)

  return NextResponse.json({ logo_url: signedData?.signedUrl, logo_storage_path: path })
}
