import { createHash } from 'node:crypto'
import {
  ConditioningProgressionPolicyV1Schema,
  type ConditioningProgressionPolicyV1,
} from '../contracts/conditioning-progression'
import type { ExecutionContextV1 } from '../contracts/program'
import { SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'

const SYNTHETIC_POLICY_VALUES = Object.freeze({
  schemaVersion: 'conditioning-progression-policy.v1' as const,
  policyVersion: 'conditioning-duration-v1' as const,
  modalityId: 'synthetic-continuous-walking.v1',
  targetEffortMaximum: 4,
  maxIncreasePerBoutSeconds: 120 as const,
  maxTotalWeeklyIncreaseSeconds: 240 as const,
  maxBoutDurationSeconds: 1_800 as const,
  maxPlannedWeeklyDurationSeconds: 3_600 as const,
})

export const SYNTHETIC_CONDITIONING_PROGRESSION_POLICY_FIXTURE_HASH = createHash('sha256')
  .update(JSON.stringify(SYNTHETIC_POLICY_VALUES))
  .digest('hex')

export const SYNTHETIC_CONDITIONING_PROGRESSION_POLICY: ConditioningProgressionPolicyV1 =
  ConditioningProgressionPolicyV1Schema.parse({
    ...SYNTHETIC_POLICY_VALUES,
    origin: {
      kind: 'synthetic_fixture',
      sourceVersion: 'conditioning-duration-policy-fixture.v1',
      fixtureId: 'synthetic-conditioning-duration-policy.v1',
      fixtureHash: SYNTHETIC_CONDITIONING_PROGRESSION_POLICY_FIXTURE_HASH,
      label: 'Synthetic conditioning duration policy for Practice data',
    },
  })

/**
 * There is deliberately no live fallback. Live policies must be added to a
 * reviewed, versioned registry rather than inferred from a prose effort cue.
 */
export function resolveConditioningProgressionPolicy(
  modalityId: string,
  executionContext: ExecutionContextV1,
): ConditioningProgressionPolicyV1 | null {
  if (executionContext.kind !== 'synthetic_simulation'
    || executionContext.fixtureId !== 'synthetic-starter-catalog.v1'
    || executionContext.fixtureHash !== SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH
    || modalityId !== SYNTHETIC_CONDITIONING_PROGRESSION_POLICY.modalityId) {
    return null
  }
  return SYNTHETIC_CONDITIONING_PROGRESSION_POLICY
}
