import { describe, expect, it } from 'vitest'

import { isProductionLegalDocumentPublished } from './publication'

describe('production legal publication', () => {
  it('does not publish fixture-only legal pages', () => {
    expect(isProductionLegalDocumentPublished('privacy')).toBe(false)
    expect(isProductionLegalDocumentPublished('terms')).toBe(false)
  })
})
