import { describe, expect, test, vi } from 'vitest'
import { verifyClinicalContentAccess } from './database'
import type { ClinicalContentAccess } from './policy'

const approved: ClinicalContentAccess = {
  mode: 'approved',
  reason: 'hg03_release_verified',
  contentVersion: 'release-v1',
  inventorySha256: 'a'.repeat(64),
  surfaces: { recommendations: true, programs: true, workouts: false, knowledgeLinks: true },
  approvedItemIds: ['muscle:test'],
  approvedMuscleSlugs: ['test'],
  approvedExerciseSlugs: [],
  approvedLinkIds: [],
  approvedExerciseMuscleIds: [],
  approvedContraindicationIds: [],
  approvedReportCopyIds: [],
  approvedAlgorithmIds: [],
}

describe('verifyClinicalContentAccess', () => {
  test('preserves access only when the database confirms the exact activation tuple', async () => {
    process.env.CLINICAL_CONTENT_HG03_RECEIPT_SHA256 = 'b'.repeat(64)
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })

    await expect(verifyClinicalContentAccess(approved, { rpc } as never)).resolves.toEqual(approved)
    expect(rpc).toHaveBeenCalledWith('verify_clinical_content_activation', expect.objectContaining({
      p_release_id: 'release-v1',
      p_inventory_sha256: 'a'.repeat(64),
      p_receipt_sha256: 'b'.repeat(64),
      p_workouts_enabled: false,
    }))
  })

  test.each([
    { data: false, error: null },
    { data: null, error: { message: 'unavailable' } },
  ])('fails closed for mismatch or database error: $data', async (result) => {
    const access = await verifyClinicalContentAccess(approved, {
      rpc: vi.fn().mockResolvedValue(result),
    } as never)

    expect(access.mode).toBe('disabled')
    expect(access.reason).toBe('database_activation_mismatch')
    expect(Object.values(access.surfaces).every((enabled) => !enabled)).toBe(true)
  })

  test('fails closed when the database attestation request rejects', async () => {
    const access = await verifyClinicalContentAccess(approved, {
      rpc: vi.fn().mockRejectedValue(new Error('network unavailable')),
    } as never)

    expect(access.mode).toBe('disabled')
    expect(access.reason).toBe('database_activation_mismatch')
  })

  test('does not require a database round trip while source policy is disabled', async () => {
    const rpc = vi.fn()
    const disabled = { ...approved, mode: 'disabled' as const, contentVersion: null }

    await expect(verifyClinicalContentAccess(disabled, { rpc } as never)).resolves.toEqual(disabled)
    expect(rpc).not.toHaveBeenCalled()
  })
})
