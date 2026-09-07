import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  mode: vi.fn(), getUser: vi.fn(), admission: vi.fn(), governed: vi.fn(), practitioner: vi.fn(),
}))
vi.mock('@/lib/prototype/runtime', () => ({ configuredOperationMode: mocks.mode }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerAdmission: mocks.admission }))
vi.mock('./database', () => ({ serverClinicalContentAccess: mocks.governed, serverClinicalContentAccessForPractitioner: mocks.practitioner }))
import { currentPractitionerClinicalContentAccess } from './current-practitioner'

describe('original application content authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode.mockReturnValue('prototype')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    mocks.admission.mockResolvedValue({ response: null, practitioner: { id: 'owner' } })
    mocks.governed.mockResolvedValue({ mode: 'disabled' })
    mocks.practitioner.mockResolvedValue({ mode: 'prototype' })
  })
  it('resolves operator content only after practitioner admission', async () => {
    expect(await currentPractitionerClinicalContentAccess()).toEqual({ mode: 'prototype' })
    expect(mocks.admission).toHaveBeenCalled()
    expect(mocks.practitioner).toHaveBeenCalledWith('owner')
  })
  it('keeps signed-out visitors on the governed projection', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await currentPractitionerClinicalContentAccess()).toEqual({ mode: 'disabled' })
    expect(mocks.practitioner).not.toHaveBeenCalled()
  })
  it('does not expose prototype content after failed admission', async () => {
    mocks.admission.mockResolvedValue({ response: { status: 403 }, practitioner: null })
    expect(await currentPractitionerClinicalContentAccess()).toEqual({ mode: 'disabled' })
    expect(mocks.practitioner).not.toHaveBeenCalled()
  })
  it('preserves the default governed content path without an extra account lookup', async () => {
    mocks.mode.mockReturnValue('governed')
    expect(await currentPractitionerClinicalContentAccess()).toEqual({ mode: 'disabled' })
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
})
