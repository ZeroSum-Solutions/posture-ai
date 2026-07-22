import { describe, expect, it } from 'vitest'

import { API_TARGETS, apiExecutionIdentity, concurrentClientName } from './run-api'

const pickerFixture = {
  fixture_id: 'seeded_records_150',
  fixture_record_count: 150,
  practitioner_id: 'practitioner',
  anchor_client_id: 'client',
  expected_client_ids: ['client'],
  expected_picker_client_ids: ['client'],
  expected_assessment_ids: ['assessment'],
  browser: {
    fixture_id: 'seeded_records_150',
    client_id: 'client',
    assessment_id: 'assessment',
    prior_assessment_id: 'prior',
    client_search_query: 'Perf150 Name',
    client_display_name: 'Perf150 Anchor',
    consent_ready_client_id: 'client',
  },
}

describe('API runner identity', () => {
  it('identifies Node fetch as browser-not-applicable using validator-compatible Node version', () => {
    const identity = apiExecutionIdentity({})
    expect(identity.evidence_class).toBe('LOCAL_ONLY')
    expect(identity.runner_fingerprint).toMatchObject({
      node_version: process.versions.node,
      browser_name: 'not_applicable',
      browser_build: 'not_applicable',
    })
    expect(identity.runner_fingerprint.node_version).not.toMatch(/^v/)
  })

  it('refuses to label an arbitrary environment as official evidence', () => {
    expect(() => apiExecutionIdentity({ PERF_OFFICIAL_RUN: '1' })).toThrow(/frozen GitHub/)
  })

  it('measures the assessment picker through its real server-search request', () => {
    const picker = API_TARGETS.find((target) => target.targetId === 'assessment_client_picker')
    expect(picker?.requestPath(pickerFixture)).toBe('/api/clients?limit=50&search=Perf150%20Name')
  })

  it('makes the picker concurrent insert match the active search filter', () => {
    expect(concurrentClientName('assessment_client_picker', pickerFixture)).toEqual({
      firstName: 'Perf150 Name',
      lastName: 'Concurrent',
    })
    expect(concurrentClientName('clients_api_list', pickerFixture)).toEqual({
      firstName: 'Concurrent',
      lastName: 'Newer',
    })
  })
})
