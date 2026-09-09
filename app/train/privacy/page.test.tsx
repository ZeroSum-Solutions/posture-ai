// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const actor = vi.hoisted(() => vi.fn())
const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`redirect:${url}`) }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/training/access/server-actor', () => ({ requireTrainingServerActor: actor }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('./TrainingSubjectErasure', () => ({ default: ({ userId, subjectId }: { userId: string; subjectId: string }) => <div>{userId}:{subjectId}</div> }))

import TrainPrivacyPage from './page'

afterEach(cleanup)

describe('/train/privacy', () => {
  beforeEach(() => actor.mockReset().mockResolvedValue({
    ok: true, actorKind: 'athlete', userId: 'owner-user', subjectId: '72000000-0000-4000-8000-000000000001',
  }))

  test('renders only for the authenticated athlete subject derived by the server', async () => {
    render(await TrainPrivacyPage())
    expect(screen.getByRole('heading', { name: 'Training data' })).toBeTruthy()
    expect(screen.getByText(/owner-user:72000000/)).toBeTruthy()
  })

  test('redirects practitioners and failed admission without accepting a subject query', async () => {
    actor.mockResolvedValueOnce({ ok: true, actorKind: 'practitioner', userId: 'coach', subjectId: null })
    await expect(TrainPrivacyPage()).rejects.toThrow('redirect:/workouts')
    actor.mockResolvedValueOnce({ ok: false, code: 'unauthorized', status: 401 })
    await expect(TrainPrivacyPage()).rejects.toThrow('redirect:/auth/sign-in?next=/train/privacy')
    actor.mockResolvedValueOnce({ ok: false, code: 'mfa_required', status: 403 })
    await expect(TrainPrivacyPage()).rejects.toThrow('redirect:/auth/mfa?next=/train/privacy')
  })
})
