// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import LegalDocumentView from './LegalDocumentView'
import { SUBJECT_CONSENT_SNAPSHOT } from './legal-test-fixture'

afterEach(cleanup)

describe('LegalDocumentView', () => {
  it('renders versioned legal content as a semantic article and sections', () => {
    render(<LegalDocumentView document={SUBJECT_CONSENT_SNAPSHOT} headingLevel={2} />)

    const article = screen.getByRole('article', { name: 'Consent to Posture Screening' })
    expect(within(article).getByRole('heading', { level: 2, name: 'Consent to Posture Screening' })).toBeTruthy()
    expect(within(article).getByRole('heading', { level: 3, name: 'Your rights' })).toBeTruthy()
    expect(within(article).getByText('You may withdraw consent.')).toBeTruthy()
    expect(within(article).getByText('Ask the practitioner to delete your data.')).toBeTruthy()
    expect(within(article).getByText(/Version test-1/)).toBeTruthy()
    expect(within(article).getByText(/Effective Jul 20, 2026/)).toBeTruthy()
    expect(within(article).getByText(/US · en-US · us_fitness_wellness_assessment_beta_v1/)).toBeTruthy()
    expect(within(article).getByText(new RegExp(SUBJECT_CONSENT_SNAPSHOT.documentId))).toBeTruthy()
    expect(within(article).getByText(new RegExp(SUBJECT_CONSENT_SNAPSHOT.bodySha256))).toBeTruthy()
  })

  it('visibly announces non-production fixture content', () => {
    render(<LegalDocumentView document={SUBJECT_CONSENT_SNAPSHOT} />)
    expect(screen.getByRole('status').textContent).toContain('NON-PRODUCTION LEGAL FIXTURE')
  })
})
