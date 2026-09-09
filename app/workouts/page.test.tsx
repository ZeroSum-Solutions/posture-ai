// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkoutsPage from './page'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('not-found') }))
vi.mock('next/navigation', () => ({ notFound, redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) } })),
  createSupabaseServiceClient: vi.fn(),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerAdmission: vi.fn(async () => ({ response: null })) }))
vi.mock('@/lib/clinical-content/database', () => ({ serverClinicalContentAccessForPractitioner: vi.fn(async () => ({ surfaces: { workouts: true }, contentVersion: 'v1' })) }))
vi.mock('@/lib/prototype/runtime', () => ({ operationForPractitioner: vi.fn() }))
vi.mock('./WorkoutLibrary', () => ({ default: () => <div>Legacy workout library</div> }))
vi.mock('./_strength/TrainingProgramWorkspace', () => ({
  default: ({ assignmentId, sessionHrefBase, backHref }: { assignmentId: string; sessionHrefBase: string; backHref: string }) => <div data-testid="program-workspace">{assignmentId}:{sessionHrefBase}:{backHref}</div>,
}))

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe('WorkoutsPage training program composition', () => {
  it('renders the practitioner program workspace without loading the legacy service-role library', async () => {
    render(await WorkoutsPage({ searchParams: Promise.resolve({ training_program_id: 'assignment-12' }) }))
    expect(screen.getByTestId('program-workspace').textContent).toBe('assignment-12:/workouts:/workouts')
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('rejects ambiguous program and session selections', async () => {
    await expect(WorkoutsPage({ searchParams: Promise.resolve({ training_program_id: 'assignment-12', training_session_id: 'session-1' }) })).rejects.toThrow('not-found')
    expect(notFound).toHaveBeenCalledTimes(1)
  })
})
