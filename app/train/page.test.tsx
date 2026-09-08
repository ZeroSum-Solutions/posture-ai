import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrainPage from './page'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/training/access/server-actor', () => ({ requireTrainingServerActor: mocks.actor }))
vi.mock('@/app/workouts/_strength/StrengthBuilderEntry', () => ({
  default: ({ source }: { source: { kind: string; subject: { id: string; name: string } } }) => (
    <div>{`builder:${source.kind}:${source.subject.id}:${source.subject.name}`}</div>
  ),
}))
vi.mock('@/app/workouts/_strength/TrainingSessionPlayer', () => ({
  default: ({ sessionId }: { sessionId: string }) => <div>{`player:${sessionId}`}</div>,
}))

beforeEach(() => {
  mocks.actor.mockReset()
  mocks.redirect.mockClear()
})

describe('TrainPage', () => {
  it('redirects an unauthenticated request to sign in with the train return path', async () => {
    mocks.actor.mockResolvedValue({ ok: false, status: 401, code: 'unauthorized' })

    await expect(TrainPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/auth/sign-in?next=/train')
  })

  it('redirects a practitioner to the existing Workouts workspace', async () => {
    mocks.actor.mockResolvedValue({ ok: true, userId: 'practitioner-1', actorKind: 'practitioner', subjectId: null })

    await expect(TrainPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/workouts')
  })

  it('derives the live athlete subject only from the authenticated server actor', async () => {
    mocks.actor.mockResolvedValue({
      ok: true,
      userId: 'athlete-user-1',
      actorKind: 'athlete',
      subjectId: '11111111-1111-4111-8111-111111111111',
    })

    const html = renderToStaticMarkup(await TrainPage({
      searchParams: Promise.resolve({ subjectId: 'attacker-supplied-subject' } as { subjectId: string }),
    }))

    expect(html).toContain('builder:live_subject:11111111-1111-4111-8111-111111111111:Your training')
    expect(html).not.toContain('attacker-supplied-subject')
  })

  it('renders an owned session from the route selector with a train return link', async () => {
    mocks.actor.mockResolvedValue({
      ok: true,
      userId: 'athlete-user-1',
      actorKind: 'athlete',
      subjectId: '11111111-1111-4111-8111-111111111111',
    })

    const html = renderToStaticMarkup(await TrainPage({
      searchParams: Promise.resolve({ training_session_id: '22222222-2222-4222-8222-222222222222' }),
    }))

    expect(html).toContain('player:22222222-2222-4222-8222-222222222222')
    expect(html).toContain('href="/train"')
  })

  it('routes an athlete who still needs MFA to the existing MFA flow', async () => {
    mocks.actor.mockResolvedValue({ ok: false, status: 403, code: 'mfa_required' })

    await expect(TrainPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/auth/mfa?next=/train')
  })
})
