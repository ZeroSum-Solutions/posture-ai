import { describe, expect, it } from 'vitest'
import { parseAssessmentProcessingResult } from './processingStatus'

const ASSESSMENT_ID = '81da03e0-6f9e-4e88-9ba1-59121047159e'

describe('parseAssessmentProcessingResult', () => {
  it('treats complete as terminal without requiring available findings', () => {
    expect(parseAssessmentProcessingResult({
      id: ASSESSMENT_ID,
      status: 'complete',
      findings: [],
      screening_context: { scanUse: 'unavailable' },
    }, ASSESSMENT_ID)).toEqual({ id: ASSESSMENT_ID, status: 'complete' })
  })

  it('accepts only the requested assessment and a closed processing state', () => {
    expect(parseAssessmentProcessingResult({ id: 'other', status: 'complete' }, ASSESSMENT_ID)).toBeNull()
    expect(parseAssessmentProcessingResult({ id: ASSESSMENT_ID, status: 'unknown' }, ASSESSMENT_ID)).toBeNull()
    expect(parseAssessmentProcessingResult(null, ASSESSMENT_ID)).toBeNull()
  })
})
