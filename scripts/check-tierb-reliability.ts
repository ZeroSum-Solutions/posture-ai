import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateTierBChain,
  type TierBPublicEnvelope,
  type TierBTrustPolicy,
  type TierBValidationResult,
} from '../lib/reliability/tierb-validator'
import type { TierBSha256 } from '../lib/reliability/tierb-canonical'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const TIER_B_PREPARED_PACKET_PATH = resolve(
  ROOT,
  'docs/qa/tierb-reliability/prepared.packet.json',
)
export const TIER_B_TRUST_POLICY_PATH = resolve(
  ROOT,
  'docs/qa/tierb-reliability/trust-policy.json',
)
export const TIER_B_TRUST_POLICY_PIN_PATH = resolve(
  ROOT,
  'docs/qa/tierb-reliability/trust-policy.pin.json',
)

interface TierBTrustPolicyPin {
  schemaVersion: 'tierb-trust-policy-pin-v1'
  trustPolicySha256: TierBSha256
}

export interface TierBPreparedCheckInput {
  packet: TierBPublicEnvelope
  trustPolicy: TierBTrustPolicy
  trustPolicyPin: TierBTrustPolicyPin
}

export function checkTierBPrepared(
  input: TierBPreparedCheckInput,
  now = new Date().toISOString(),
): TierBValidationResult {
  if (input.trustPolicyPin.schemaVersion !== 'tierb-trust-policy-pin-v1') {
    throw new Error('Tier B trust-policy pin schema is invalid')
  }
  const result = validateTierBChain({
    envelopes: [{ publicEnvelope: input.packet }],
    trustPolicy: input.trustPolicy,
    expectedTrustPolicySha256: input.trustPolicyPin.trustPolicySha256,
    expectedTrustPolicyEnvironment: 'production',
    expectedState: 'prepared',
    now,
  })
  if (!result.ok
    || result.state !== 'prepared'
    || result.collectionAuthorized
    || result.consumerEligible) {
    throw new Error(
      `Tier B prepared packet failed closed: ${result.errors
        .map((error) => `${error.code}@${error.path}`)
        .join(', ') || 'unsafe state flags'}`,
    )
  }
  return result
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function argument(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a path`)
  return resolve(value)
}

export function runTierBPreparedCheck(argv: readonly string[] = []): string {
  const packet = readJson<TierBPublicEnvelope>(
    argument(argv, 'packet', TIER_B_PREPARED_PACKET_PATH),
  )
  const trustPolicy = readJson<TierBTrustPolicy>(
    argument(argv, 'trust-policy', TIER_B_TRUST_POLICY_PATH),
  )
  const trustPolicyPin = readJson<TierBTrustPolicyPin>(
    argument(argv, 'trust-policy-pin', TIER_B_TRUST_POLICY_PIN_PATH),
  )
  const result = checkTierBPrepared({ packet, trustPolicy, trustPolicyPin })
  return `${JSON.stringify({
    status: 'PASS',
    state: result.state,
    collectionAuthorized: result.collectionAuthorized,
    consumerEligible: result.consumerEligible,
    productionTrustedKeyCount: trustPolicy.keys.length,
  })}\n`
}

function main() {
  try {
    process.stdout.write(runTierBPreparedCheck(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(
      `Tier B reliability check failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    )
    process.exitCode = 1
  }
}

if (!process.env.VITEST) main()
