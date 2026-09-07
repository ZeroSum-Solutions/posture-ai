import { describe, expect, it } from 'vitest'
import { PROTOTYPE_REPORT_NOTICE, reportNoticeCaption } from './notice'

describe('prototype report provenance', () => {
  it('does not invent legal document or approval metadata', () => {
    expect(PROTOTYPE_REPORT_NOTICE).not.toHaveProperty('documentId')
    expect(PROTOTYPE_REPORT_NOTICE).not.toHaveProperty('version')
    expect(PROTOTYPE_REPORT_NOTICE).not.toHaveProperty('bodySha256')
    expect(reportNoticeCaption(PROTOTYPE_REPORT_NOTICE)).toBe('Prototype report · Clinical review is not asserted.')
  })
})
