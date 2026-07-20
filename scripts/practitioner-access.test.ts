import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertMutationTarget, beginMfaRecovery, invite, normalizePractitionerEmail, revoke } from './practitioner-access'

describe('practitioner access operator guardrails', () => {
  it('normalizes exact invitation email casing without provider-specific alias rules', () => {
    expect(normalizePractitionerEmail('  Clinician+Beta@Example.COM ')).toBe('clinician+beta@example.com')
  })

  it.each(['missing-at.example.com', 'space @example.com', ''])('rejects malformed email %j', (email) => {
    expect(() => normalizePractitionerEmail(email)).toThrow()
  })

  it('allows local Auth targets without a remote acknowledgement', () => {
    expect(assertMutationTarget('http://127.0.0.1:54321').hostname).toBe('127.0.0.1')
    expect(assertMutationTarget('http://localhost:54321').hostname).toBe('localhost')
  })

  it('refuses remote Auth mutation without the exact acknowledgement', () => {
    expect(() => assertMutationTarget('https://project.supabase.co')).toThrow('Refusing remote Auth mutation')
    expect(() => assertMutationTarget('https://project.supabase.co', 'yes')).toThrow('Refusing remote Auth mutation')
  })

  it('accepts the exact remote acknowledgement', () => {
    expect(
      assertMutationTarget(
        'https://project.supabase.co',
        'I_ACKNOWLEDGE_THIS_MUTATES_AUTH',
    ).hostname,
    ).toBe('project.supabase.co')
  })

  it('finishes a pending-invitation revocation without calling the Auth provider for a null user id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateUserById = vi.fn()
    const client = {
      rpc,
      auth: { admin: { updateUserById } },
    } as unknown as SupabaseClient

    await revoke(client, 'pending@example.test', 'operator', 'invitation withdrawn')

    expect(rpc).toHaveBeenCalledWith('revoke_practitioner_access_by_bound_email', {
      p_email: 'pending@example.test',
      p_reason: 'invitation withdrawn',
      p_actor: 'operator',
    })
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('rolls back a newly-created allowlist row when provider invitation fails', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: {
          invitation_id: 'invite-1',
          created: true,
          delivery: 'invite',
          target_email: 'new@example.test',
          rollback_on_failure: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null })
    const inviteUserByEmail = vi.fn().mockResolvedValue({
      error: { message: 'provider unavailable' },
    })
    const client = {
      rpc,
      auth: { admin: { inviteUserByEmail } },
    } as unknown as SupabaseClient

    await expect(invite(
      client,
      'new@example.test',
      'operator',
      'http://127.0.0.1:3100',
      'New Practitioner',
    )).rejects.toThrow('Auth invitation failed: provider unavailable')

    expect(rpc).toHaveBeenNthCalledWith(2, 'revoke_practitioner_access_by_bound_email', {
      p_email: 'new@example.test',
      p_reason: 'provider_invitation_failed',
      p_actor: 'operator',
    })
  })

  it('never revokes an existing invitation when a provider retry fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        invitation_id: 'invite-1',
        created: false,
        delivery: 'recovery',
        target_email: 'existing@example.test',
        rollback_on_failure: false,
      },
      error: null,
    })
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      error: { message: 'user already registered' },
    })
    const client = {
      rpc,
      auth: { admin: { inviteUserByEmail: vi.fn() }, resetPasswordForEmail },
    } as unknown as SupabaseClient

    await expect(invite(
      client,
      'existing@example.test',
      'operator',
      'http://127.0.0.1:3100',
      null,
    )).rejects.toThrow('Auth invitation failed: user already registered')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('issue_practitioner_invitation_with_state', expect.any(Object))
  })

  it('leaves recovery blocked and never finalizes when factor deletion fails', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { user_id: 'user-1', target_email: 'recover@example.test' },
      error: null,
    })
    const listFactors = vi.fn().mockResolvedValue({
      data: { factors: [{ id: 'factor-1' }] },
      error: null,
    })
    const deleteFactor = vi.fn().mockResolvedValue({
      error: { message: 'provider failed' },
    })
    const resetPasswordForEmail = vi.fn()
    const client = {
      rpc,
      auth: { admin: { mfa: { listFactors, deleteFactor } }, resetPasswordForEmail },
    } as unknown as SupabaseClient

    await expect(beginMfaRecovery(
      client,
      'recover@example.test',
      'operator',
      'lost device',
      'http://127.0.0.1:3100',
    )).rejects.toThrow('Access remains recovery-pending; factor deletion failed')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('finalizes recovery only after factor deletion, then sends the recovery link', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: { user_id: 'user-1', target_email: 'current@example.test' },
        error: null,
      })
      .mockResolvedValueOnce({ data: '2026-07-20T00:00:01Z', error: null })
    const deleteFactor = vi.fn().mockResolvedValue({ error: null })
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    const client = {
      rpc,
      auth: {
        admin: {
          mfa: {
            listFactors: vi.fn().mockResolvedValue({
              data: { factors: [{ id: 'factor-1' }, { id: 'factor-2' }] },
              error: null,
            }),
            deleteFactor,
          },
        },
        resetPasswordForEmail,
      },
    } as unknown as SupabaseClient

    await beginMfaRecovery(
      client,
      'original@example.test',
      'operator',
      'lost device',
      'http://127.0.0.1:3100/',
    )

    expect(deleteFactor).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_practitioner_mfa_recovery', {
      p_user_id: 'user-1',
      p_actor: 'operator',
    })
    expect(resetPasswordForEmail).toHaveBeenCalledWith('current@example.test', {
      redirectTo: 'http://127.0.0.1:3100/auth/update-password',
    })
  })
})
