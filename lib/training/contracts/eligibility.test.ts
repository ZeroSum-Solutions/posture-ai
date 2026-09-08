import { describe, expect, it } from 'vitest'
import {
  ELIGIBILITY_ANSWERS_SCHEMA_VERSION,
  ELIGIBILITY_DECISION_SCHEMA_VERSION,
  EligibilityAnswersV1Schema,
  EligibilityAuthorizationV1Schema,
  EligibilityDecisionV1Schema,
  EligibilitySnapshotV1Schema,
  gateEligibilityAnswersForAssignment,
} from './eligibility'

const validAnswers = {
  schemaVersion: 'eligibility-answers.v1',
  questionnaireSourceVersion: 'preparticipation-inputs.v1-unvalidated',
  submittedAt: '2026-09-07T18:00:00.000Z',
  origin: { kind: 'athlete_self_report' as const },
  adultScope: 'confirmed_18_plus' as const,
  currentActivity: 'regularly_active' as const,
  knownConditions: {
    cardiovascular: 'no' as const,
    metabolic: 'no' as const,
    renal: 'no' as const,
  },
  relevantSignsOrSymptoms: 'no' as const,
  desiredIntensity: 'moderate' as const,
  answerCertainty: 'complete' as const,
  pregnancyPostpartumContext: 'none_reported' as const,
  requestedProgrammingScope: 'strength_or_general_fitness' as const,
}

const decisionBase = {
  schemaVersion: 'eligibility-decision.v1',
  sourceRevisionId: 'eligibility-decision-revision-1',
  answersRevisionId: 'eligibility-answers-revision-1',
  answersSchemaVersion: 'eligibility-answers.v1',
  questionnaireSourceVersion: 'preparticipation-inputs.v1-unvalidated',
  policyVersion: 'clinically-reviewed-policy-fixture.v1',
  state: 'eligible_general' as const,
  scope: 'supported' as const,
  source: {
    kind: 'policy_service' as const,
    sourceVersion: 'eligibility-policy-service.v1' as const,
    evaluatedAt: '2026-09-07T18:05:00.000Z',
  },
  effectiveFrom: '2026-09-07T18:05:00.000Z',
  effectiveUntil: null,
  supersededAt: null,
  constraintSet: null,
}

describe('EligibilityAnswersV1Schema', () => {
  it('accepts versioned athlete answers without deriving a decision', () => {
    const parsed = EligibilityAnswersV1Schema.parse(validAnswers)

    expect(parsed).toEqual(validAnswers)
    expect('state' in parsed).toBe(false)
    expect(ELIGIBILITY_ANSWERS_SCHEMA_VERSION).toBe('eligibility-answers.v1')
  })

  it.each(['confirmed_18_plus', 'minor', 'unknown'] as const)(
    'preserves the closed adult-scope answer %s',
    (adultScope) => {
      expect(EligibilityAnswersV1Schema.parse({ ...validAnswers, adultScope }).adultScope)
        .toBe(adultScope)
    },
  )

  it('rejects unknown answer states, questionnaire versions, and omitted uncertainty', () => {
    expect(EligibilityAnswersV1Schema.safeParse({
      ...validAnswers,
      adultScope: 'probably_adult',
    }).success).toBe(false)
    expect(EligibilityAnswersV1Schema.safeParse({
      ...validAnswers,
      questionnaireSourceVersion: 'preparticipation-inputs.v2',
    }).success).toBe(false)
    const withoutCertainty: Partial<typeof validAnswers> = { ...validAnswers }
    delete withoutCertainty.answerCertainty
    expect(EligibilityAnswersV1Schema.safeParse(withoutCertainty).success).toBe(false)
  })

  it('rejects client-submitted decision, clearance, or constraint fields', () => {
    for (const extra of [
      { state: 'eligible_general' },
      { scope: 'supported' },
      { eligibilityDecision: decisionBase },
      { constraints: [] },
    ]) {
      expect(EligibilityAnswersV1Schema.safeParse({ ...validAnswers, ...extra }).success)
        .toBe(false)
    }
  })

  it('preserves pregnancy/postpartum context without treating it as a ban or clearance', () => {
    const pregnancy = EligibilityAnswersV1Schema.parse({
      ...validAnswers,
      pregnancyPostpartumContext: 'pregnant',
    })
    const postpartum = EligibilityAnswersV1Schema.parse({
      ...validAnswers,
      pregnancyPostpartumContext: 'postpartum',
    })

    expect(gateEligibilityAnswersForAssignment(pregnancy)).toEqual({
      status: 'unavailable',
      state: 'unanswered',
      scope: 'supported',
      reason: 'eligibility_policy_unvalidated',
      sourceRevisionId: null,
      policyVersion: null,
    })
    expect(gateEligibilityAnswersForAssignment(postpartum))
      .toEqual(gateEligibilityAnswersForAssignment(pregnancy))
  })

  it.each(['minor', 'unknown'] as const)(
    'makes assignment unavailable for adult scope %s',
    (adultScope) => {
      expect(gateEligibilityAnswersForAssignment({ ...validAnswers, adultScope }))
        .toMatchObject({
          status: 'unavailable',
          state: 'unanswered',
          reason: 'adult_scope_unavailable',
        })
    },
  )

  it.each(['specialized_programming', 'unknown'] as const)(
    'makes assignment unavailable for programming scope %s',
    (requestedProgrammingScope) => {
      expect(gateEligibilityAnswersForAssignment({
        ...validAnswers,
        requestedProgrammingScope,
      })).toMatchObject({
        status: 'unavailable',
        reason: 'eligibility_scope_unavailable',
      })
    },
  )

  it('keeps incomplete or uncertain answers unavailable without interpreting them clinically', () => {
    expect(gateEligibilityAnswersForAssignment({
      ...validAnswers,
      currentActivity: 'unknown',
      relevantSignsOrSymptoms: 'unknown',
      answerCertainty: 'uncertain',
    })).toMatchObject({
      status: 'unavailable',
      reason: 'answers_incomplete_or_uncertain',
    })
  })

  it('requires synthetic answer fixtures to be visibly labeled and never authorizes them', () => {
    expect(EligibilityAnswersV1Schema.safeParse({
      ...validAnswers,
      origin: { kind: 'synthetic_fixture', fixtureId: 'answers-1' },
    }).success).toBe(false)
    const fixture = EligibilityAnswersV1Schema.parse({
      ...validAnswers,
      origin: {
        kind: 'synthetic_fixture',
        fixtureId: 'answers-1',
        label: 'SYNTHETIC — no real athlete clearance',
      },
    })
    expect(gateEligibilityAnswersForAssignment(fixture)).toMatchObject({
      status: 'unavailable',
      reason: 'synthetic_fixture',
    })
  })
})

describe('EligibilityDecisionV1Schema', () => {
  it('accepts all five closed eligibility states and all three scope states', () => {
    for (const state of [
      'unanswered',
      'eligible_general',
      'needs_clinical_review',
      'acute_stop',
    ] as const) {
      expect(EligibilityDecisionV1Schema.safeParse({ ...decisionBase, state }).success)
        .toBe(true)
    }
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      state: 'cleared_with_constraints',
      source: {
        kind: 'qualified_reviewer',
        sourceVersion: 'qualified-review.v1',
        reviewerReference: 'reviewer-record-1',
        scopeEvidenceReference: 'scope-evidence-1',
        reviewedAt: '2026-09-07T18:05:00.000Z',
      },
      constraintSet: {
        status: 'unavailable',
        reason: 'constraint_contract_unvalidated',
      },
    }).success).toBe(true)
    for (const scope of ['supported', 'outside_release', 'unanswered'] as const) {
      expect(EligibilityDecisionV1Schema.safeParse({ ...decisionBase, scope }).success)
        .toBe(true)
    }
  })

  it('rejects unknown states, unknown decision source versions, and inconsistent chronology', () => {
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      state: 'cleared',
    }).success).toBe(false)
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      source: { ...decisionBase.source, sourceVersion: 'policy-service.v2' },
    }).success).toBe(false)
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      effectiveUntil: '2026-09-07T17:00:00.000Z',
    }).success).toBe(false)
  })

  it('does not represent cleared constraints before a reviewed constraint vocabulary exists', () => {
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      state: 'cleared_with_constraints',
      constraints: [{ exerciseId: 'squat', maxLoad: '100' }],
    }).success).toBe(false)
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      state: 'cleared_with_constraints',
      constraintSet: null,
    }).success).toBe(false)
  })

  it('requires synthetic decisions to carry a visible fixture label', () => {
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      source: {
        kind: 'synthetic_fixture',
        sourceVersion: 'synthetic-eligibility-fixture.v1',
        fixtureId: 'decision-fixture-1',
      },
    }).success).toBe(false)
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      source: {
        kind: 'synthetic_fixture',
        sourceVersion: 'synthetic-eligibility-fixture.v1',
        fixtureId: 'decision-fixture-1',
        label: 'SYNTHETIC — not a real eligibility decision',
      },
    }).success).toBe(true)
  })
})

describe('eligibility authorization contracts', () => {
  it('exposes the exact immutable decision revision used by progression', () => {
    expect(EligibilitySnapshotV1Schema.parse({
      state: 'eligible_general',
      scope: 'supported',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
      sourceRevisionId: 'eligibility-decision-revision-1',
      source: decisionBase.source,
      effectiveFrom: '2026-09-07T18:05:00.000Z',
      effectiveUntil: null,
      supersededAt: null,
    })).toEqual({
      state: 'eligible_general',
      scope: 'supported',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
      sourceRevisionId: 'eligibility-decision-revision-1',
      source: decisionBase.source,
      effectiveFrom: '2026-09-07T18:05:00.000Z',
      effectiveUntil: null,
      supersededAt: null,
    })
  })

  it('requires authoritative source and lifecycle provenance on eligibility snapshots', () => {
    expect(EligibilitySnapshotV1Schema.safeParse({
      state: 'eligible_general',
      scope: 'supported',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
      sourceRevisionId: 'eligibility-decision-revision-1',
    }).success).toBe(false)

    expect(EligibilitySnapshotV1Schema.safeParse({
      state: 'eligible_general',
      scope: 'supported',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
      sourceRevisionId: 'eligibility-decision-revision-1',
      source: {
        kind: 'synthetic_fixture',
        sourceVersion: 'synthetic-eligibility-fixture.v1',
        fixtureId: 'snapshot-fixture-1',
        label: 'SYNTHETIC eligibility snapshot',
      },
      effectiveFrom: '2026-09-07T18:05:00.000Z',
      effectiveUntil: null,
      supersededAt: null,
    }).success).toBe(true)
  })

  it('rejects inconsistent snapshot effective and supersession chronology', () => {
    const snapshot = {
      state: 'eligible_general' as const,
      scope: 'supported' as const,
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
      sourceRevisionId: 'eligibility-decision-revision-1',
      source: decisionBase.source,
      effectiveFrom: '2026-09-07T18:05:00.000Z',
      effectiveUntil: '2026-09-07T18:04:59.000Z',
      supersededAt: null,
    }
    expect(EligibilitySnapshotV1Schema.safeParse(snapshot).success).toBe(false)
    expect(EligibilitySnapshotV1Schema.safeParse({
      ...snapshot,
      effectiveUntil: null,
      supersededAt: '2026-09-07T18:04:59.000Z',
    }).success).toBe(false)
  })

  it('permits an available projection only for an authoritative general/supported decision', () => {
    expect(EligibilityAuthorizationV1Schema.safeParse({
      status: 'available',
      state: 'eligible_general',
      scope: 'supported',
      sourceRevisionId: 'eligibility-decision-revision-1',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
    }).success).toBe(true)
    expect(EligibilityAuthorizationV1Schema.safeParse({
      status: 'available',
      state: 'cleared_with_constraints',
      scope: 'supported',
      sourceRevisionId: 'eligibility-decision-revision-2',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
    }).success).toBe(false)
    expect(EligibilityAuthorizationV1Schema.safeParse({
      status: 'available',
      state: 'eligible_general',
      scope: 'outside_release',
      sourceRevisionId: 'eligibility-decision-revision-1',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
    }).success).toBe(false)
  })

  it('models constrained and unvalidated paths as explicitly unavailable', () => {
    expect(EligibilityAuthorizationV1Schema.parse({
      status: 'unavailable',
      state: 'cleared_with_constraints',
      scope: 'supported',
      reason: 'eligibility_constraints_unavailable',
      sourceRevisionId: 'eligibility-decision-revision-2',
      policyVersion: 'clinically-reviewed-policy-fixture.v1',
    })).toMatchObject({
      status: 'unavailable',
      reason: 'eligibility_constraints_unavailable',
    })
    expect(EligibilityAuthorizationV1Schema.parse({
      status: 'unavailable',
      state: 'unanswered',
      scope: 'supported',
      reason: 'eligibility_policy_unvalidated',
      sourceRevisionId: null,
      policyVersion: null,
    })).toMatchObject({
      status: 'unavailable',
      reason: 'eligibility_policy_unvalidated',
    })
  })

  it('exports the decision schema version without accepting a future shape silently', () => {
    expect(ELIGIBILITY_DECISION_SCHEMA_VERSION).toBe('eligibility-decision.v1')
    expect(EligibilityDecisionV1Schema.parse(decisionBase).schemaVersion)
      .toBe(ELIGIBILITY_DECISION_SCHEMA_VERSION)
    expect(EligibilityDecisionV1Schema.safeParse({
      ...decisionBase,
      schemaVersion: 'eligibility-decision.v2',
    }).success).toBe(false)
  })
})
