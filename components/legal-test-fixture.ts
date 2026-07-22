import type { LegalSnapshot } from '@/lib/legal/types'

export const SUBJECT_CONSENT_SNAPSHOT: LegalSnapshot = {
  schemaVersion: 1,
  documentId: 'subject-consent-test-fixture-v1',
  kind: 'subject_consent',
  version: 'test-1',
  title: 'Consent to Posture Screening',
  effectiveAt: '2026-07-20T00:00:00.000Z',
  jurisdiction: 'US',
  locale: 'en-US',
  productScope: 'us_fitness_wellness_assessment_beta_v1',
  audience: 'subject',
  bodySha256: 'a'.repeat(64),
  text: 'Consent to Posture Screening\n\nYour rights\n\nYou may withdraw consent.',
  sections: [{
    id: 'your-rights',
    heading: 'Your rights',
    paragraphs: ['You may withdraw consent.'],
    bullets: ['Ask the practitioner to delete your data.'],
  }],
  isFixture: true,
}

export const SCREENING_NOTICE_SNAPSHOT: LegalSnapshot = {
  ...SUBJECT_CONSENT_SNAPSHOT,
  documentId: 'screening-notice-test-fixture-v1',
  kind: 'screening_notice',
  title: 'Screening Notice',
  audience: 'public',
  text: 'Screening tool only. This is not a medical diagnosis.',
  sections: [{
    id: 'screening-only',
    heading: null,
    paragraphs: ['Screening tool only. This is not a medical diagnosis.'],
  }],
}
