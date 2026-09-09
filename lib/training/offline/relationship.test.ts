import { describe, expect, it, vi } from 'vitest'
import { clearOfflineSessionsAfterRelationshipRevocation } from './relationship'

const receipt = {
  subjectId: '72000000-0000-4000-8000-000000000001',
  relationshipId: 'relationship-1',
  affectedSessionIds: ['coach-session-1', 'coach-session-2'],
}

describe('relationship revocation offline cleanup', () => {
  it('forwards the exact validated receipt scopes to the active-user outbox', async () => {
    const clearSessionScopes = vi.fn().mockResolvedValue({ kind: 'cleared', clearedCount: 2 })
    await expect(clearOfflineSessionsAfterRelationshipRevocation(receipt, { clearSessionScopes }))
      .resolves.toEqual({ kind: 'cleared', clearedCount: 2 })
    expect(clearSessionScopes).toHaveBeenCalledWith(receipt.subjectId, receipt.affectedSessionIds)
  })

  it('rejects duplicate or malformed receipt bindings before clearing', async () => {
    const clearSessionScopes = vi.fn()
    await expect(clearOfflineSessionsAfterRelationshipRevocation({
      ...receipt,
      affectedSessionIds: ['coach-session-1', 'coach-session-1'],
    }, { clearSessionScopes })).rejects.toThrow(/unique/i)
    await expect(clearOfflineSessionsAfterRelationshipRevocation({
      ...receipt,
      relationshipId: '',
    }, { clearSessionScopes })).rejects.toThrow()
    expect(clearSessionScopes).not.toHaveBeenCalled()
  })

  it('preserves a complete server receipt with more than 128 affected sessions', async () => {
    const affectedSessionIds = Array.from({ length: 129 }, (_, index) => `coach-session-${index + 1}`)
    const clearSessionScopes = vi.fn().mockResolvedValue({ kind: 'cleared', clearedCount: 0 })
    await clearOfflineSessionsAfterRelationshipRevocation({
      ...receipt,
      affectedSessionIds,
    }, { clearSessionScopes })
    expect(clearSessionScopes).toHaveBeenCalledWith(receipt.subjectId, affectedSessionIds)
  })
})
