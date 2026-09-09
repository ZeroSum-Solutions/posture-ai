import { SYNTHETIC_STARTER_CATALOG } from './syntheticStarter'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from './syntheticSwapJourney'
import {
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
  SYNTHETIC_CONDITIONING_JOURNEY_PAIRING,
} from './syntheticConditioningJourney'
import type { TrainingCatalogOriginV1, TrainingCatalogV1 } from './types'
import {
  catalogOriginsMatch,
  type ExecutionContextV1,
} from '../contracts/program'
import {
  ConditioningPairingPolicyV1Schema,
  type ConditioningPairingPolicyV1,
} from '../contracts/conditioning-revision'
import {
  BodyweightAssistanceProgressionPolicyV1Schema,
  type BodyweightAssistancePolicyReferenceV1,
  type BodyweightAssistanceProgressionPolicyV1,
} from '../contracts/bodyweight-assistance'
import {
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_POLICY_DEFINITIONS,
} from './syntheticBodyweightAssistance'

const catalogs = Object.freeze([
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_SWAP_JOURNEY_CATALOG,
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
])

export function resolveSyntheticBodyweightAssistancePolicy(
  reference: BodyweightAssistancePolicyReferenceV1,
  context: ExecutionContextV1,
): BodyweightAssistanceProgressionPolicyV1 | null {
  if (context.kind !== 'synthetic_simulation'
    || context.fixtureId !== SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID
    || context.fixtureHash !== SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH) return null

  const definition = SYNTHETIC_BODYWEIGHT_ASSISTANCE_POLICY_DEFINITIONS.find(policy => (
    policy.policyId === reference.policyId && policy.policyVersion === reference.policyVersion
  ))
  if (!definition) return null
  return BodyweightAssistanceProgressionPolicyV1Schema.parse({
    ...definition,
    provenance: {
      kind: 'synthetic_fixture',
      fixtureId: context.fixtureId,
      fixtureHash: context.fixtureHash,
      label: context.label,
    },
  })
}

export function resolveSyntheticTrainingCatalog(
  catalogVersion: string,
  catalogOrigin: TrainingCatalogOriginV1,
): TrainingCatalogV1 | null {
  return catalogs.find(catalog => (
    catalog.catalogVersion === catalogVersion
    && catalogOriginsMatch(catalog.origin, catalogOrigin)
  )) ?? null
}

export function resolveSyntheticTrainingCatalogByFixture(
  fixtureId: string,
  fixtureHash: string,
): TrainingCatalogV1 | null {
  return catalogs.find(catalog => (
    catalog.origin.kind === 'synthetic_fixture'
    && catalog.origin.fixtureId === fixtureId
    && catalog.origin.fixtureHash === fixtureHash
  )) ?? null
}

export function resolveSyntheticConditioningPairingPolicies(
  context: ExecutionContextV1,
  catalog: TrainingCatalogV1,
): readonly ConditioningPairingPolicyV1[] {
  const registeredCatalog = resolveSyntheticTrainingCatalog(
    catalog.catalogVersion,
    catalog.origin,
  )
  if (context.kind !== 'synthetic_simulation'
    || registeredCatalog !== SYNTHETIC_CONDITIONING_JOURNEY_CATALOG
    || JSON.stringify(catalog) !== JSON.stringify(registeredCatalog)
    || catalog.origin.kind !== 'synthetic_fixture'
    || context.fixtureId !== catalog.origin.fixtureId
    || context.fixtureHash !== catalog.origin.fixtureHash) return Object.freeze([])

  return Object.freeze(Object.entries(SYNTHETIC_CONDITIONING_JOURNEY_PAIRING).map(
    ([modalityId, pairing]) => Object.freeze(ConditioningPairingPolicyV1Schema.parse({
      schemaVersion: 'conditioning-pairing-policy.v1',
      modalityId,
      catalogVersion: catalog.catalogVersion,
      pairing,
      provenance: {
        kind: 'synthetic_fixture',
        fixtureId: context.fixtureId,
        fixtureHash: context.fixtureHash,
        label: context.label,
      },
    })),
  ))
}
