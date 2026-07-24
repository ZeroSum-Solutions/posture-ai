import { describe, expect, it } from 'vitest'
import {
  checkTierBPrepared,
  runTierBPreparedCheck,
  TIER_B_PREPARED_PACKET_PATH,
  TIER_B_TRUST_POLICY_PATH,
  TIER_B_TRUST_POLICY_PIN_PATH,
} from './check-tierb-reliability'
import type {
  TierBPublicEnvelope,
  TierBTrustPolicy,
} from '../lib/reliability/tierb-validator'
import { readFileSync } from 'node:fs'

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

describe('checked-in Tier B preparation packet', () => {
  it('validates as prepared with no collection or consumer authority', () => {
    expect(JSON.parse(runTierBPreparedCheck())).toEqual({
      status: 'PASS',
      state: 'prepared',
      collectionAuthorized: false,
      consumerEligible: false,
      productionTrustedKeyCount: 0,
    })
  })

  it('fails if the packet self-authorizes or the independent trust pin drifts', () => {
    const packet = readJson<TierBPublicEnvelope>(TIER_B_PREPARED_PACKET_PATH)
    const trustPolicy = readJson<TierBTrustPolicy>(TIER_B_TRUST_POLICY_PATH)
    const trustPolicyPin = readJson<{
      schemaVersion: 'tierb-trust-policy-pin-v1'
      trustPolicySha256: `sha256:${string}`
    }>(TIER_B_TRUST_POLICY_PIN_PATH)

    expect(() => checkTierBPrepared({
      packet: {
        ...packet,
        payload: {
          ...(packet.payload as Record<string, unknown>),
          collectionAuthorized: true,
        },
      },
      trustPolicy,
      trustPolicyPin,
    })).toThrow('failed closed')

    expect(() => checkTierBPrepared({
      packet,
      trustPolicy,
      trustPolicyPin: {
        ...trustPolicyPin,
        trustPolicySha256: `sha256:${'f'.repeat(64)}`,
      },
    })).toThrow('failed closed')
  })
})
