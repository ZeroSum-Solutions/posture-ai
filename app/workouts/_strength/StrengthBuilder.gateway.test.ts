import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptTrainingBuild, publishTrainingDraft, requestTrainingBuild, requestTrainingPrograms } from './StrengthBuilder.gateway'

afterEach(() => vi.unstubAllGlobals())

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('strength builder gateway', () => {
  it('builds from canonical identity and saved revision without sending profile or context JSON', async () => {
    let requestInit: RequestInit | undefined
    const fetch = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      requestInit = args[1]
      return response({
        schemaVersion: 'training-build-projection.v1',
        buildId: 'build-1',
        result: { kind: 'draft_program' },
        calibrations: [{
          exerciseLabel: 'Goblet squat',
          calibration: { exerciseInstanceId: 'exercise-1', exerciseVersionId: 'goblet.v1', options: [] },
        }],
      })
    })
    vi.stubGlobal('fetch', fetch)

    await requestTrainingBuild({ subjectId: 'subject-1', profileRevision: 3, cycleStartLocalDate: '2026-09-14' })

    expect(fetch).toHaveBeenCalledWith('/api/training/programs/builds', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ subjectId: 'subject-1', profileRevision: 3, cycleStartLocalDate: '2026-09-14' }),
    }))
    const sent = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['cycleStartLocalDate', 'profileRevision', 'subjectId'])
  })

  it('accepts bounded representative choices before publishing only the returned draft ID', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ schemaVersion: 'training-build-acceptance.v1', buildId: 'build/1', draftId: 'draft-1' }))
      .mockResolvedValueOnce(response({ assignmentId: 'assignment-1' }))
      .mockResolvedValueOnce(response({
        program: {
          sessions: [{ sessionId: 'strength-session-1' }],
          conditioningBouts: [{ boutId: 'conditioning-session-1' }],
        },
      }))
    vi.stubGlobal('fetch', fetch)
    const selection = {
      loadChoices: [{ exerciseInstanceId: 'exercise-1', optionIndex: 2 }] as const,
      conditioningChoices: [{ boutId: 'bout-1', acceptedDurationSeconds: 600 }] as const,
    }

    const accepted = await acceptTrainingBuild('build/1', selection)
    const result = await publishTrainingDraft(accepted.draftId)

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/training/programs/builds/build%2F1/accept', expect.objectContaining({
      body: JSON.stringify(selection),
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/training/programs/publish', expect.objectContaining({
      body: JSON.stringify({ draftId: 'draft-1' }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/training/programs/assignment-1', { cache: 'no-store' })
    expect(result).toEqual({
      status: 'accepted', draftId: 'draft-1', assignmentId: 'assignment-1',
      firstStrengthSessionId: 'strength-session-1', firstConditioningSessionId: 'conditioning-session-1',
    })
  })

  it('does not publish when starting-target acceptance fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ code: 'invalid_choice' }, 422))
    vi.stubGlobal('fetch', fetch)

    await expect(acceptTrainingBuild('build-1', {
      loadChoices: [{ exerciseInstanceId: 'exercise-1', optionIndex: 2 }],
      conditioningChoices: [{ boutId: 'bout-1', acceptedDurationSeconds: 600 }],
    })).rejects.toThrow('Starting targets could not be accepted')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('loads only the selected canonical subject program list', async () => {
    const fetch = vi.fn(async () => response({
      schemaVersion: 'training-program-list.v1', subjectId: 'subject-1', programs: [],
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(requestTrainingPrograms('subject-1')).resolves.toMatchObject({ programs: [] })
    expect(fetch).toHaveBeenCalledWith('/api/training/programs?subjectId=subject-1', { cache: 'no-store' })
  })
})
