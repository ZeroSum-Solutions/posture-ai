import { z } from 'zod'
import type { ExecutionContextV1 } from '../contracts/program'

export const StrengthProgrammingStyleV1Schema = z.enum([
  'repeatable',
  'intermediate_undulating',
])

export const StrengthExposureTypeV1Schema = z.enum(['heavy', 'volume'])
export const INTERMEDIATE_UNDULATING_TEMPLATE_ID = 'intermediate-undulating' as const
export const INTERMEDIATE_UNDULATING_TEMPLATE_VERSION = 'intermediate-undulating.v1' as const

const stableReferenceSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const exposurePrescriptionSchema = z.object({
  exposureType: StrengthExposureTypeV1Schema,
  repRange: z.object({
    minimum: z.number().int().min(1).max(100),
    maximum: z.number().int().min(1).max(100),
  }).strict(),
  targetRir: z.object({
    minimum: z.literal(2),
    maximum: z.literal(3),
  }).strict(),
  restSeconds: z.number().int().min(0).max(3_600),
}).strict().superRefine((prescription, ctx) => {
  if (prescription.repRange.minimum > prescription.repRange.maximum) {
    ctx.addIssue({
      code: 'custom',
      message: 'Exposure rep range is inverted',
      path: ['repRange', 'minimum'],
    })
  }
})

const templateProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('synthetic_fixture'),
    fixtureId: stableReferenceSchema,
    fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.enum(['Practice data', 'Simulation']),
  }).strict(),
  z.object({
    kind: z.literal('reviewed_authored_template'),
    templateRecordId: stableReferenceSchema,
    reviewRecordId: stableReferenceSchema,
    reviewedAt: z.string().datetime({ offset: true }),
  }).strict(),
])

export const IntermediateUndulatingTemplateV1Schema = z.object({
  schemaVersion: z.literal('strength-template.v1'),
  style: z.literal('intermediate_undulating'),
  templateId: stableReferenceSchema,
  templateVersion: stableReferenceSchema,
  provenance: templateProvenanceSchema,
  heavy: exposurePrescriptionSchema.safeExtend({
    exposureType: z.literal('heavy'),
  }),
  volume: exposurePrescriptionSchema.safeExtend({
    exposureType: z.literal('volume'),
  }),
}).strict().superRefine((template, ctx) => {
  if (template.heavy.repRange.maximum >= template.volume.repRange.minimum) {
    ctx.addIssue({
      code: 'custom',
      message: 'Heavy and volume rep ranges must remain distinct',
      path: ['volume', 'repRange', 'minimum'],
    })
  }
})

export type StrengthProgrammingStyleV1 = z.infer<typeof StrengthProgrammingStyleV1Schema>
export type StrengthExposureTypeV1 = z.infer<typeof StrengthExposureTypeV1Schema>
export type StrengthExposurePrescriptionV1 = z.infer<typeof exposurePrescriptionSchema>
export type IntermediateUndulatingTemplateV1 = z.infer<typeof IntermediateUndulatingTemplateV1Schema>

/**
 * Server-owned registries resolve template review provenance. Compiler callers
 * select a style; they do not submit a template or a review assertion.
 */
export interface StrengthTemplateRegistryV1 {
  readonly resolve: (
    style: 'intermediate_undulating',
    context: ExecutionContextV1,
  ) => unknown | null
}

/** Structural provenance binding only; live authorization still requires a trusted server registry. */
export function strengthTemplateMatchesExecutionContext(
  template: IntermediateUndulatingTemplateV1,
  context: ExecutionContextV1,
): boolean {
  const provenance = template.provenance
  if (context.kind === 'live') return provenance.kind === 'reviewed_authored_template'
  return provenance.kind === 'synthetic_fixture'
    && provenance.fixtureId === context.fixtureId
    && provenance.fixtureHash === context.fixtureHash
    && provenance.label === context.label
}

/** Product checkpoint prescriptions; these values do not imply superiority. */
export function createSyntheticIntermediateUndulatingTemplate(
  context: Extract<ExecutionContextV1, { kind: 'synthetic_simulation' }>,
): IntermediateUndulatingTemplateV1 {
  return IntermediateUndulatingTemplateV1Schema.parse({
    schemaVersion: 'strength-template.v1',
    style: 'intermediate_undulating',
    templateId: INTERMEDIATE_UNDULATING_TEMPLATE_ID,
    templateVersion: INTERMEDIATE_UNDULATING_TEMPLATE_VERSION,
    provenance: {
      kind: 'synthetic_fixture',
      fixtureId: context.fixtureId,
      fixtureHash: context.fixtureHash,
      label: context.label,
    },
    heavy: {
      exposureType: 'heavy',
      repRange: { minimum: 6, maximum: 8 },
      targetRir: { minimum: 2, maximum: 3 },
      restSeconds: 180,
    },
    volume: {
      exposureType: 'volume',
      repRange: { minimum: 10, maximum: 12 },
      targetRir: { minimum: 2, maximum: 3 },
      restSeconds: 120,
    },
  })
}

export function resolveIntermediateUndulatingTemplate(
  context: ExecutionContextV1,
  registry: StrengthTemplateRegistryV1 | undefined,
): IntermediateUndulatingTemplateV1 | null {
  if (!registry) return null
  const parsed = IntermediateUndulatingTemplateV1Schema.safeParse(
    registry.resolve('intermediate_undulating', context),
  )
  if (!parsed.success) return null

  return strengthTemplateMatchesExecutionContext(parsed.data, context) ? parsed.data : null
}
