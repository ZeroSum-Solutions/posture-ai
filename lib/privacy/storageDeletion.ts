import type { SupabaseClient } from '@supabase/supabase-js'

type DeletionJob = {
  id: string
  deletion_receipt_id: string
  bucket: string
  object_path: string
}

export type StorageDeletionSummary = {
  claimed: number
  completed: number
  pending: number
  claimFailed?: true
  receiptStatus?: 'pending' | 'complete'
}

/**
 * Best-effort drain for the durable storage-deletion outbox. Database erasure
 * has already committed before this runs. A provider failure records only a
 * controlled code; the lease expires and a later scheduled run retries it.
 */
export async function drainStorageDeletionOutbox(
  service: SupabaseClient,
  options: { receiptId?: string; limit?: number } = {},
): Promise<StorageDeletionSummary> {
  const { data, error } = await service.rpc('claim_privacy_storage_deletions', {
    p_limit: options.limit ?? 25,
    p_receipt_id: options.receiptId ?? null,
  })
  if (error || !Array.isArray(data)) {
    return { claimed: 0, completed: 0, pending: 1, claimFailed: true }
  }

  const jobs = data as DeletionJob[]
  let completed = 0
  let pending = 0

  for (const job of jobs) {
    let succeeded = false
    try {
      const result = await service.storage.from(job.bucket).remove([job.object_path])
      succeeded = !result.error
    } catch {
      succeeded = false
    }

    const { data: recorded, error: recordError } = await service.rpc(
      'complete_privacy_storage_deletion',
      {
        p_job_id: job.id,
        p_succeeded: succeeded,
        p_error_code: succeeded ? null : 'storage_delete_failed',
      },
    )
    if (succeeded && !recordError && recorded === true) completed += 1
    else pending += 1
  }

  if (options.receiptId) {
    const { data: receipt } = await service
      .from('client_deletion_log')
      .select('external_deletion_status')
      .eq('id', options.receiptId)
      .maybeSingle()
    const receiptStatus = receipt?.external_deletion_status === 'complete' ? 'complete' : 'pending'
    return { claimed: jobs.length, completed, pending, receiptStatus }
  }

  return { claimed: jobs.length, completed, pending }
}
