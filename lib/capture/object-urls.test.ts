import { describe, it, expect, vi, beforeEach } from 'vitest'
import { revokeStaleUrls } from './object-urls'

describe('revokeStaleUrls', () => {
  beforeEach(() => {
    // jsdom doesn't implement revokeObjectURL — stub it to record calls.
    URL.revokeObjectURL = vi.fn()
  })

  it('revokes old blob URLs that are not reused', () => {
    revokeStaleUrls(['blob:a', 'blob:b'], new Set())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:a')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:b')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('keeps a URL that the replacement still holds', () => {
    revokeStaleUrls(['blob:keep', 'blob:drop'], new Set(['blob:keep']))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:drop')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:keep')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('never revokes non-blob URLs (uploads / data URLs) or nullish entries', () => {
    revokeStaleUrls(['data:image/jpeg;base64,xxx', 'http://x/y.jpg', null, undefined], new Set())
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
