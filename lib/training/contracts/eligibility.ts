import { z } from 'zod'

export const ELIGIBILITY_ANSWERS_SCHEMA_VERSION = 'eligibility-answers.v1' as const
export const ELIGIBILITY_DECISION_SCHEMA_VERSION = 'eligibility-decision.v1' as const
export const ELIGIBILITY_QUESTIONNAIRE_SOURCE_VERSION = 'preparticipation-inputs.v1-unvalidated' as const

const stableReferenceSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const versionSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const isoDateTimeSchema = z.string().datetime({ offset: true })
const visibleSyntheticLabelSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .refine(label => /synthetic/i.test(label), 'Synthetic fixtures require a visible synthetic label')

export const EligibilityStateV1Schema = z.enum([
  'unanswered',
  'eligible_general',
  'needs_clinical_review',
  'acute_stop',
  'cleared_with_constraints',
])

export const EligibilityScopeV1Schema = z.enum([
  'supported',
  'outside_release',
  'unanswered',
])

const answerOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('athlete_self_report') }).strict(),
  z.object({
    kind: z.literal('synthetic_fixture'),
    fixtureId: stableReferenceSchema,
    label: visibleSyntheticLabelSchema,
  }).strict(),
])

const yesNoUnknownSchema = z.enum(['yes', 'no', 'unknown'])

export const EligibilityAnswersV1Schema = z.object({
  schemaVersion: z.literal(ELIGIBILITY_ANSWERS_SCHEMA_VERSION),
  questionnaireSourceVersion: z.literal(ELIGIBILITY_QUESTIONNAIRE_SOURCE_VERSION),
  submittedAt: isoDateTimeSchema,
  origin: answerOriginSchema,
  adultScope: z.enum(['confirmed_18_plus', 'minor', 'unknown']),
  currentActivity: z.enum(['regularly_active', 'not_regularly_active', 'unknown']),
  knownConditions: z.object({
    cardiovascular: yesNoUnknownSchema,
    metabolic: yesNoUnknownSchema,
    renal: yesNoUnknownSchema,
  }).strict(),
  relevantSignsOrSymptoms: yesNoUnknownSchema,
  desiredIntensity: z.enum(['light', 'moderate', 'vigorous', 'unknown']),
  answerCertainty: z.enum(['complete', 'uncertain']),
  pregnancyPostpartumContext: z.enum([
    'none_reported', 'pregnant', 'postpartum', 'unknown', 'prefer_not_to_say',
  ]),
  requestedProgrammingScope: z.enum([
    'strength_or_general_fitness', 'specialized_programming', 'unknown',
  ]),
}).strict()

const decisionSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('policy_service'),
    sourceVersion: z.literal('eligibility-policy-service.v1'),
    evaluatedAt: isoDateTimeSchema,
  }).strict(),
  z.object({
    kind: z.literal('qualified_reviewer'),
    sourceVersion: z.literal('qualified-review.v1'),
    reviewerReference: stableReferenceSchema,
    scopeEvidenceReference: stableReferenceSchema,
    reviewedAt: isoDateTimeSchema,
  }).strict(),
  z.object({
    kind: z.literal('synthetic_fixture'),
    sourceVersion: z.literal('synthetic-eligibility-fixture.v1'),
    fixtureId: stableReferenceSchema,
    label: visibleSyntheticLabelSchema,
  }).strict(),
])

const unavailableConstraintSetSchema = z.object({
  status: z.literal('unavailable'),
  reason: z.literal('constraint_contract_unvalidated'),
}).strict()

interface EligibilityLifecycleWindow {
  effectiveFrom: string
  effectiveUntil: string | null
  supersededAt: string | null
}

function addEligibilityChronologyIssues(
  lifecycle: EligibilityLifecycleWindow,
  ctx: z.RefinementCtx,
): void {
  const effectiveFrom = Date.parse(lifecycle.effectiveFrom)
  if (
    lifecycle.effectiveUntil !== null
    && Date.parse(lifecycle.effectiveUntil) < effectiveFrom
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Eligibility expiry cannot precede its effective time',
      path: ['effectiveUntil'],
    })
  }
  if (
    lifecycle.supersededAt !== null
    && Date.parse(lifecycle.supersededAt) < effectiveFrom
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Supersession cannot precede the decision effective time',
      path: ['supersededAt'],
    })
  }
}

export const EligibilityDecisionV1Schema = z.object({
  schemaVersion: z.literal(ELIGIBILITY_DECISION_SCHEMA_VERSION),
  sourceRevisionId: stableReferenceSchema,
  answersRevisionId: stableReferenceSchema,
  answersSchemaVersion: z.literal(ELIGIBILITY_ANSWERS_SCHEMA_VERSION),
  questionnaireSourceVersion: z.literal(ELIGIBILITY_QUESTIONNAIRE_SOURCE_VERSION),
  policyVersion: versionSchema,
  state: EligibilityStateV1Schema,
  scope: EligibilityScopeV1Schema,
  source: decisionSourceSchema,
  effectiveFrom: isoDateTimeSchema,
  effectiveUntil: isoDateTimeSchema.nullable(),
  supersededAt: isoDateTimeSchema.nullable(),
  constraintSet: z.union([z.null(), unavailableConstraintSetSchema]),
}).strict().superRefine((decision, ctx) => {
  addEligibilityChronologyIssues(decision, ctx)

  if (decision.state === 'cleared_with_constraints') {
    if (decision.source.kind !== 'qualified_reviewer') {
      ctx.addIssue({
        code: 'custom',
        message: 'Constrained clearance requires qualified reviewer provenance',
        path: ['source'],
      })
    }
    if (decision.constraintSet?.reason !== 'constraint_contract_unvalidated') {
      ctx.addIssue({
        code: 'custom',
        message: 'Constraint authorization is unavailable until its vocabulary is validated',
        path: ['constraintSet'],
      })
    }
  } else if (decision.constraintSet !== null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Only constrained-clearance decisions may carry a constraint extension marker',
      path: ['constraintSet'],
    })
  }

})

export const EligibilitySnapshotV1Schema = z.object({
  state: EligibilityStateV1Schema,
  scope: EligibilityScopeV1Schema,
  policyVersion: versionSchema,
  sourceRevisionId: stableReferenceSchema,
  source: decisionSourceSchema,
  effectiveFrom: isoDateTimeSchema,
  effectiveUntil: isoDateTimeSchema.nullable(),
  supersededAt: isoDateTimeSchema.nullable(),
}).strict().superRefine(addEligibilityChronologyIssues)

export const EligibilityUnavailableReasonV1Schema = z.enum([
  'adult_scope_unavailable',
  'eligibility_scope_unavailable',
  'answers_incomplete_or_uncertain',
  'eligibility_policy_unvalidated',
  'decision_missing',
  'decision_expired',
  'decision_superseded',
  'clinical_review_required',
  'acute_stop',
  'eligibility_constraints_unavailable',
  'synthetic_fixture',
])

const availableAuthorizationSchema = z.object({
  status: z.literal('available'),
  state: z.literal('eligible_general'),
  scope: z.literal('supported'),
  sourceRevisionId: stableReferenceSchema,
  policyVersion: versionSchema,
}).strict()

const unavailableAuthorizationSchema = z.object({
  status: z.literal('unavailable'),
  state: EligibilityStateV1Schema,
  scope: EligibilityScopeV1Schema,
  reason: EligibilityUnavailableReasonV1Schema,
  sourceRevisionId: stableReferenceSchema.nullable(),
  policyVersion: versionSchema.nullable(),
}).strict()

export const EligibilityAuthorizationV1Schema = z.discriminatedUnion('status', [
  availableAuthorizationSchema,
  unavailableAuthorizationSchema,
])

export type EligibilityStateV1 = z.infer<typeof EligibilityStateV1Schema>
export type EligibilityScopeV1 = z.infer<typeof EligibilityScopeV1Schema>
export type EligibilityAnswersV1 = z.infer<typeof EligibilityAnswersV1Schema>
export type EligibilityDecisionV1 = z.infer<typeof EligibilityDecisionV1Schema>
export type EligibilitySnapshotV1 = z.infer<typeof EligibilitySnapshotV1Schema>
export type EligibilityUnavailableReasonV1 = z.infer<typeof EligibilityUnavailableReasonV1Schema>
export type EligibilityAuthorizationV1 = z.infer<typeof EligibilityAuthorizationV1Schema>

function unavailable(
  scope: EligibilityScopeV1,
  reason: EligibilityUnavailableReasonV1,
): EligibilityAuthorizationV1 {
  return {
    status: 'unavailable',
    state: 'unanswered',
    scope,
    reason,
    sourceRevisionId: null,
    policyVersion: null,
  }
}

/**
 * Applies only the explicit non-clinical answer gates. It deliberately has no
 * path to an available result: an approved policy decision must supply that
 * later, and pregnancy/postpartum context is preserved without interpretation.
 */
export function gateEligibilityAnswersForAssignment(
  input: unknown,
): EligibilityAuthorizationV1 {
  const answers = EligibilityAnswersV1Schema.parse(input)
  const scope: EligibilityScopeV1 = answers.requestedProgrammingScope === 'strength_or_general_fitness'
    ? 'supported'
    : answers.requestedProgrammingScope === 'specialized_programming'
      ? 'outside_release'
      : 'unanswered'

  if (answers.origin.kind === 'synthetic_fixture') {
    return unavailable(scope, 'synthetic_fixture')
  }
  if (answers.adultScope !== 'confirmed_18_plus') {
    return unavailable(scope, 'adult_scope_unavailable')
  }
  if (scope !== 'supported') {
    return unavailable(scope, 'eligibility_scope_unavailable')
  }
  if (
    answers.answerCertainty !== 'complete'
    || answers.currentActivity === 'unknown'
    || answers.relevantSignsOrSymptoms === 'unknown'
    || answers.desiredIntensity === 'unknown'
    || Object.values(answers.knownConditions).includes('unknown')
  ) {
    return unavailable(scope, 'answers_incomplete_or_uncertain')
  }
  return unavailable(scope, 'eligibility_policy_unvalidated')
}
