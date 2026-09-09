import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestProgramOptions } from './ProgramOptions.gateway'

const subjectId = '11111111-1111-4111-8111-111111111111'
const options = {
  schemaVersion: 'training-program-options.v1', subjectId, profileRevision: 4,
  executionContext: { kind: 'live' }, catalogVersion: 'catalog.v1',
  catalogOrigin: { kind: 'authored_catalog' }, conditioningPreference: { status: 'required' },
  conditioningModes: [{ modalityId: 'walking.v1', label: 'Walking' }], exerciseOptions: [],
}
afterEach(() => vi.unstubAllGlobals())
describe('requestProgramOptions', () => {
  it('loads and validates exact subject/revision choices without caching', async () => {
    const fetcher = vi.fn(async () => Response.json(options))
    vi.stubGlobal('fetch', fetcher)
    expect(await requestProgramOptions(subjectId, 4)).toEqual(options)
    expect(fetcher).toHaveBeenCalledWith(`/api/training/programs/options?subjectId=${subjectId}&profileRevision=4`, { cache: 'no-store' })
  })
  it.each([{ ...options, profileRevision: 3 }, { ...options, subjectId: '22222222-2222-4222-8222-222222222222' }])('rejects mismatched choices', async value => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)))
    await expect(requestProgramOptions(subjectId, 4)).rejects.toThrow('current profile')
  })
  it('rejects denied access instead of reusing a successful response shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(options, { status: 403 })))
    await expect(requestProgramOptions(subjectId, 4)).rejects.toThrow('could not be loaded')
  })
  it('reports the empty reviewed catalog as an explicit unavailable state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'program_options_unavailable' }, { status: 503 })))
    await expect(requestProgramOptions(subjectId, 4)).rejects.toThrow('Reviewed program catalog is not available yet')
  })
})
