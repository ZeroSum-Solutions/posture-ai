/**
 * Tier B v2 analysis runner.
 *
 * No legacy directory is scanned, an empty dataset is never success, and
 * output is stdout-only unless the caller supplies an explicit --write path.
 *
 * npx vite-node scripts/golden-repeatability.ts -- \
 *   --chain <authorized-chain.json> \
 *   --input <restricted-analysis-input.json> \
 *   [--trust-policy <production-trust-policy.json>] \
 *   [--trust-policy-pin <independent-production-pin.json>] \
 *   [--now <ISO timestamp>] [--write <output.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TierBAnalysisInputEnvelope } from './golden-repeatability-core'
import { analyzeAuthorizedTierBInput } from './golden-repeatability-core'
import type {
  TierBPublicEnvelope,
  TierBRestrictedEnvelope,
  TierBTrustPolicy,
} from '../lib/reliability/tierb-validator'
import { validateTierBChain } from '../lib/reliability/tierb-validator'
import type { TierBSha256 } from '../lib/reliability/tierb-canonical'

interface TierBChainFile {
  schemaVersion: 'tierb-chain-v1'
  envelopes: Array<{
    publicEnvelope: TierBPublicEnvelope
    restrictedEnvelope?: TierBRestrictedEnvelope
  }>
}

interface TierBTrustPolicyPin {
  schemaVersion: 'tierb-trust-policy-pin-v1'
  trustPolicySha256: TierBSha256
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TRUST_POLICY_PATH = resolve(
  ROOT,
  'docs/qa/tierb-reliability/trust-policy.json',
)
const DEFAULT_TRUST_POLICY_PIN_PATH = resolve(
  ROOT,
  'docs/qa/tierb-reliability/trust-policy.pin.json',
)

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} requires a value`)
  }
  return value
}

function requiredArgument(argv: readonly string[], name: string): string {
  const value = argument(argv, name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T
}

export function resolveTrustClock(
  environment: TierBTrustPolicy['environment'],
  requestedNow: string | null,
  wallClockNow = new Date().toISOString(),
): string {
  if (environment === 'production' && requestedNow) {
    throw new Error('--now is fixture-only and cannot override the production trust clock')
  }
  return requestedNow ?? wallClockNow
}

export function runGoldenRepeatability(argv: readonly string[]): string {
  const chain = readJson<TierBChainFile>(requiredArgument(argv, 'chain'))
  const trustPolicy = readJson<TierBTrustPolicy>(
    argument(argv, 'trust-policy') ?? DEFAULT_TRUST_POLICY_PATH,
  )
  const trustPolicyPin = readJson<TierBTrustPolicyPin>(
    argument(argv, 'trust-policy-pin') ?? DEFAULT_TRUST_POLICY_PIN_PATH,
  )
  const input = readJson<TierBAnalysisInputEnvelope>(requiredArgument(argv, 'input'))
  const requestedNow = argument(argv, 'now')
  const now = resolveTrustClock(trustPolicy.environment, requestedNow)

  if (chain.schemaVersion !== 'tierb-chain-v1' || !Array.isArray(chain.envelopes)) {
    throw new Error('Tier B chain file is invalid')
  }
  if (trustPolicyPin.schemaVersion !== 'tierb-trust-policy-pin-v1') {
    throw new Error('Tier B trust-policy pin is invalid')
  }
  const validation = validateTierBChain({
    envelopes: chain.envelopes,
    trustPolicy,
    expectedTrustPolicySha256: trustPolicyPin.trustPolicySha256,
    expectedTrustPolicyEnvironment: 'production',
    expectedState: 'collection_authorized',
    now,
  })
  if (!validation.ok || !validation.collectionAuthorized) {
    throw new Error(
      `Tier B collection is not authorized: ${validation.errors
        .map((error) => `${error.code}@${error.path}`)
        .join(', ') || 'authorization missing'}`,
    )
  }
  const authorization = chain.envelopes.at(-1)!.publicEnvelope
  const result = analyzeAuthorizedTierBInput(input, authorization)
  const rendered = `${JSON.stringify(result, null, 2)}\n`

  const writePath = argument(argv, 'write')
  if (writePath) writeFileSync(resolve(writePath), rendered, { flag: 'wx' })
  return rendered
}

function main() {
  try {
    process.stdout.write(runGoldenRepeatability(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(
      `Tier B reliability analysis refused: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    )
    process.exitCode = 2
  }
}

if (!process.env.VITEST) main()
