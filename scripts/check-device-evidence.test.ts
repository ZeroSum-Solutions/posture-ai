import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { validateDeviceEvidence, validateJsonWithSchema } from './check-device-evidence.mjs'

type DynamicJson = ReturnType<JSON['parse']>
type Json = Record<string, DynamicJson>
type ValidationResult = {
  task_id: 'HG-04'
  status: 'PASS' | 'FAIL'
  commit: string | null
  configuration_hash: string | null
  contract_sha256: string | null
  packet_sha256: string | null
  evidence_root_manifest_sha256: string | null
  mode: 'fixture' | 'physical' | null
  fixture: boolean | null
  test_mode: boolean | null
  operator_id: string | null
  packet_structurally_valid: boolean
  physical_packet_valid: boolean
  hg04_launch_eligible: boolean
  validator_is_necessary_not_sufficient: boolean
  reason_codes: string[]
}

const runValidator = validateDeviceEvidence as unknown as (input: {
  contract: Json
  contractBytes: string
  receipt: Json
  evidenceRoot: string
  expectedCommit: string
  expectedConfigurationHash: string
  releaseConfigurationReceipt?: Json
  fixture: boolean
  now: string
}) => ValidationResult

const ROOT = resolve(import.meta.dirname, '..')
const CONTRACT_BYTES = readFileSync(join(ROOT, 'docs/qa/device-release-contract.json'), 'utf8')
const CONTRACT = JSON.parse(CONTRACT_BYTES)
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'docs/qa/device-evidence.schema.json'), 'utf8'))
const CHECKLIST = readFileSync(join(ROOT, 'docs/qa/device-evidence-checklist.md'), 'utf8')
const RUNBOOK = readFileSync(join(ROOT, 'docs/RUNBOOK.md'), 'utf8')
const RECEIPT = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/device-evidence/complete/receipt.json'), 'utf8'))
const ARTIFACTS = join(import.meta.dirname, 'fixtures/device-evidence/complete/artifacts')
const COMMIT = RECEIPT.packet.release.commit
const CONFIGURATION_HASH = RECEIPT.packet.release.configuration_hash
const temporaryDirectories: string[] = []

function clone<T>(value: T): T {
  return structuredClone(value)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Json)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function validate(receipt = clone(RECEIPT), options: { contract?: Json; contractBytes?: string; evidenceRoot?: string; fixture?: boolean; commit?: string; configurationHash?: string; releaseConfigurationReceipt?: Json; now?: string } = {}) {
  const contract = options.contract ?? clone(CONTRACT)
  return runValidator({
    contract,
    contractBytes: options.contractBytes ?? (options.contract ? stable(contract) : CONTRACT_BYTES),
    receipt,
    evidenceRoot: options.evidenceRoot ?? ARTIFACTS,
    expectedCommit: options.commit ?? COMMIT,
    expectedConfigurationHash: options.configurationHash ?? CONFIGURATION_HASH,
    releaseConfigurationReceipt: options.releaseConfigurationReceipt,
    fixture: options.fixture ?? true,
    now: options.now ?? '2026-07-21T16:00:00.000Z',
  })
}

function expectReason(result: ReturnType<typeof validate>, code: string): void {
  expect(result.reason_codes).toContain(code)
  expect(result.packet_structurally_valid).toBe(false)
  expect(result.hg04_launch_eligible).toBe(false)
}

function copiedArtifacts(): string {
  const directory = mkdtempSync(join(tmpdir(), 'posture-device-evidence-'))
  temporaryDirectories.push(directory)
  cpSync(ARTIFACTS, directory, { recursive: true })
  return directory
}

function physicalReceipt(): { contract: Json; contractBytes: string; receipt: Json; evidenceRoot: string; releaseConfigurationReceipt: Json } {
  const contract = clone(CONTRACT)
  const receipt = clone(RECEIPT)
  const evidenceRoot = copiedArtifacts()
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const fingerprint = sha256(publicKey.export({ type: 'spki', format: 'der' }) as Buffer)
  const contractBytes = CONTRACT_BYTES
  receipt.packet.contract_sha256 = sha256(contractBytes)
  receipt.packet.mode = 'physical'
  receipt.packet.fixture = false
  receipt.packet.test_mode = false
  for (const run of receipt.packet.runs) {
    run.device.physical_device = true
    run.device.emulated = false
  }
  for (const item of receipt.packet.evidence) {
    const isCore = item.source_row === 'core_journey_recording'
    const matrixRow = receipt.packet.matrix.find((row: Json) => row.evidence_id === item.evidence_id)
    const identityRun = receipt.packet.runs.find((row: Json) => row.identity_evidence_id === item.evidence_id)
    const bytes = item.source_row === 'workout_audio'
      ? Buffer.from(JSON.stringify({
          device_class: matrixRow.device_class,
          run_id: matrixRow.run_id,
          configuration_hash: matrixRow.applicability_proof.configuration_hash,
          configuration_field: matrixRow.applicability_proof.configuration_field,
          configuration_value: matrixRow.applicability_proof.configuration_value,
        }))
      : item.source_row === 'device_identity'
      ? Buffer.from(JSON.stringify({ device_class: identityRun.device_class, ...identityRun.device }))
      : isCore
      ? Buffer.concat([Buffer.alloc(4), Buffer.from(`ftypDUMMY NON-PRODUCTION ${item.evidence_id}`)])
      : Buffer.from(JSON.stringify({ dummy_non_production: true, evidence_id: item.evidence_id }))
    writeFileSync(join(evidenceRoot, item.relative_path), bytes)
    item.media_type = isCore ? 'video/mp4' : 'application/json'
    item.byte_length = bytes.length
    item.sha256 = sha256(bytes)
  }
  receipt.packet.evidence_root_manifest_sha256 = sha256(stable(receipt.packet.evidence))
  const review = receipt.independent_review.receipt
  review.packet_sha256 = sha256(stable(receipt.packet))
  review.contract_sha256 = receipt.packet.contract_sha256
  const evidence = new Map<string, Json>(receipt.packet.evidence.map((row: Json) => [row.evidence_id, row]))
  const exclusions = receipt.packet.matrix.filter((row: Json) => row.status === 'not_applicable').map((row: Json) => ({ key: `${row.device_class}:${row.row_id}`, evidenceId: row.evidence_id }))
  const remaining: Array<{ key: string; evidenceId: string }> = []
  for (const deviceClass of ['iphone_safari', 'android_chrome']) {
    const candidates: Array<{ key: string; evidenceId: string }> = receipt.packet.matrix
      .filter((row: Json) => row.device_class === deviceClass && row.status === 'passed')
      .map((row: Json) => ({ key: `${deviceClass}:${row.row_id}`, evidenceId: row.evidence_id }))
      .sort((left: { key: string }, right: { key: string }) => left.key.localeCompare(right.key))
    const selected = candidates.filter(row => {
      const rowId = row.key.slice(deviceClass.length + 1)
      return Number.parseInt(sha256(`${receipt.packet.contract_sha256}|${receipt.packet.packet_id}|${deviceClass}|${rowId}`).slice(0, 2), 16) % 2 === 0
    })
    const selectedWithMandatory = new Map([
      ...candidates.filter(row => row.key === `${deviceClass}:sustained_session`),
      ...(selected.length > 0 ? selected : candidates.slice(0, 1)),
    ].map(row => [row.key, row] as const))
    remaining.push(...[...selectedWithMandatory.values()].sort((left, right) => left.key.localeCompare(right.key)))
  }
  review.sampled_remaining_row_keys = remaining.map(row => row.key)
  review.sampled_artifact_sha256 = [...new Set([
    ...receipt.packet.runs.map((row: Json) => row.core_recording_evidence_id),
    ...new Set(receipt.packet.runs.map((row: Json) => row.identity_evidence_id)),
    ...exclusions.map((row: Json) => row.evidenceId),
    ...remaining.map(row => row.evidenceId),
  ].map(id => evidence.get(id)!.sha256))]
  receipt.independent_review.signature = {
    algorithm: 'Ed25519',
    key_class: 'production',
    public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
    public_key_fingerprint: fingerprint,
    value_base64: sign(null, Buffer.from(stable(review)), privateKey).toString('base64'),
  }
  const releaseConfigurationReceipt = {
    commit: receipt.packet.release.commit,
    configuration_hash: receipt.packet.release.configuration_hash,
    hg04_approved_reviewer_public_key_fingerprints: [fingerprint],
  }
  return { contract, contractBytes, receipt, evidenceRoot, releaseConfigurationReceipt }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('device evidence validator', () => {
  it('binds the packet and review to the exact published contract bytes', () => {
    const expectedContractSha256 = sha256(CONTRACT_BYTES)
    expect(RECEIPT.packet.contract_sha256).toBe(expectedContractSha256)
    expect(RECEIPT.independent_review.receipt.contract_sha256).toBe(expectedContractSha256)
  })

  it('rejects semantically identical contract JSON with different bytes', () => {
    expectReason(validate(clone(RECEIPT), { contractBytes: `${CONTRACT_BYTES}\n` }), 'CONTRACT_BINDING')
  })

  it('accepts the complete dummy fixture without granting physical or launch eligibility', () => {
    expect(validate()).toMatchObject({
      task_id: 'HG-04',
      status: 'PASS',
      packet_structurally_valid: true,
      physical_packet_valid: false,
      hg04_launch_eligible: false,
      validator_is_necessary_not_sufficient: true,
      reason_codes: [],
    })
  })

  it('can validate a dynamically signed physical packet but still cannot authorize HG-04', () => {
    const { contract, contractBytes, receipt, evidenceRoot, releaseConfigurationReceipt } = physicalReceipt()
    expect(contract.signature.approved_reviewer_public_key_fingerprints).toEqual([])
    expect(validate(receipt, { contract, contractBytes, evidenceRoot, fixture: false, releaseConfigurationReceipt })).toMatchObject({
      task_id: 'HG-04',
      status: 'PASS',
      packet_structurally_valid: true,
      physical_packet_valid: true,
      hg04_launch_eligible: false,
      validator_is_necessary_not_sufficient: true,
      reason_codes: [],
    })
  })

  it.each([
    ['empty packet', () => ({}), 'SCHEMA_INVALID'],
    ['unknown schema version', () => ({ ...clone(RECEIPT), schema_version: 99 }), 'SCHEMA_VERSION'],
    ['unknown top-level field', () => ({ ...clone(RECEIPT), surprise: true }), 'SCHEMA_UNKNOWN_FIELD'],
    ['unknown nested field', () => { const value = clone(RECEIPT); value.packet.runs[0].device.secret = true; return value }, 'SCHEMA_UNKNOWN_FIELD'],
    ['subject-data field', () => { const value = clone(RECEIPT); value.packet.subject_name = 'forbidden'; return value }, 'SUBJECT_DATA_FORBIDDEN'],
    ['stale packet commit', () => { const value = clone(RECEIPT); value.packet.release.commit = 'f'.repeat(40); return value }, 'COMMIT_MISMATCH'],
    ['missing packet commit', () => { const value = clone(RECEIPT); delete value.packet.release.commit; return value }, 'SCHEMA_INVALID'],
    ['stale configuration hash', () => { const value = clone(RECEIPT); value.packet.release.configuration_hash = 'f'.repeat(64); return value }, 'CONFIGURATION_MISMATCH'],
    ['missing configuration hash', () => { const value = clone(RECEIPT); delete value.packet.release.configuration_hash; return value }, 'SCHEMA_INVALID'],
    ['one iPhone run', () => { const value = clone(RECEIPT); value.packet.runs.splice(1, 1); return value }, 'RUN_COUNT'],
    ['duplicate run id', () => { const value = clone(RECEIPT); value.packet.runs[1].run_id = value.packet.runs[0].run_id; return value }, 'RUN_ID_DUPLICATE'],
    ['core evidence reused across runs', () => { const value = clone(RECEIPT); value.packet.runs[1].core_recording_evidence_id = value.packet.runs[0].core_recording_evidence_id; value.packet.runs[1].journey.forEach((step: Json) => { step.evidence_id = value.packet.runs[0].core_recording_evidence_id }); return value }, 'RUN_EVIDENCE_REUSED'],
    ['reused evidence hash', () => { const value = clone(RECEIPT); value.packet.evidence[1].sha256 = value.packet.evidence[0].sha256; return value }, 'EVIDENCE_HASH_REUSED'],
    ['below iOS floor', () => { const value = clone(RECEIPT); value.packet.runs[0].device.os_version = '16.7'; return value }, 'OS_FLOOR'],
    ['below Android floor', () => { const value = clone(RECEIPT); value.packet.runs[2].device.os_version = '10'; return value }, 'OS_FLOOR'],
    ['below Chrome floor', () => { const value = clone(RECEIPT); value.packet.runs[2].device.browser_version = '149.0'; return value }, 'BROWSER_FLOOR'],
    ['wrong iPhone browser', () => { const value = clone(RECEIPT); value.packet.runs[0].device.browser_name = 'Chrome'; value.packet.runs[1].device.browser_name = 'Chrome'; return value }, 'BROWSER_IDENTITY'],
    ['wrong Android browser', () => { const value = clone(RECEIPT); value.packet.runs[2].device.browser_name = 'Safari'; value.packet.runs[3].device.browser_name = 'Safari'; return value }, 'BROWSER_IDENTITY'],
    ['garbage Chrome version suffix', () => { const value = clone(RECEIPT); value.packet.runs[2].device.browser_version = '150garbage'; value.packet.runs[3].device.browser_version = '150garbage'; return value }, 'DEVICE_VERSION'],
    ['nonnumeric browser build', () => { const value = clone(RECEIPT); value.packet.runs[0].device.browser_build = 'SafariBuild'; value.packet.runs[1].device.browser_build = 'SafariBuild'; return value }, 'DEVICE_VERSION'],
    ['flagship Android envelope', () => { const value = clone(RECEIPT); value.packet.runs[2].device.ram_gb = 12; value.packet.runs[2].device.mid_or_low_tier = false; return value }, 'ANDROID_ENVELOPE'],
    ['missing core matrix row', () => { const value = clone(RECEIPT); value.packet.matrix = value.packet.matrix.filter((row: Json) => !(row.device_class === 'iphone_safari' && row.row_id === 'screen_reader')); return value }, 'MATRIX_ROW_MISSING'],
    ['illegal core exclusion', () => { const value = clone(RECEIPT); const row = value.packet.matrix.find((entry: Json) => entry.row_id === 'screen_reader'); row.status = 'not_applicable'; return value }, 'CORE_NOT_APPLICABLE'],
    ['optional exclusion without proof', () => { const value = clone(RECEIPT); delete value.packet.matrix.find((entry: Json) => entry.row_id === 'workout_audio').applicability_proof; return value }, 'EXCLUSION_PROOF'],
    ['arbitrary disabled configuration field', () => { const value = clone(RECEIPT); value.packet.matrix.find((entry: Json) => entry.row_id === 'workout_audio').applicability_proof.configuration_field = 'totally_fake_enabled'; return value }, 'EXCLUSION_CONFIGURATION'],
    ['unrelated unsupported capability proof', () => { const value = clone(RECEIPT); const row = value.packet.matrix.find((entry: Json) => entry.device_class === 'iphone_safari' && entry.row_id === 'wake_lock'); row.status = 'not_applicable'; row.applicability_proof = { kind: 'unsupported_capability_probe', evidence_id: row.evidence_id, capability: 'bluetooth', supported: false }; return value }, 'EXCLUSION_CAPABILITY'],
    ['missing review id', () => { const value = clone(RECEIPT); delete value.independent_review.receipt.review_id; return value }, 'SCHEMA_INVALID'],
    ['blank review id', () => { const value = clone(RECEIPT); value.independent_review.receipt.review_id = '   '; return value }, 'SCHEMA_INVALID'],
    ['missing reviewer id', () => { const value = clone(RECEIPT); delete value.independent_review.receipt.reviewer_id; return value }, 'SCHEMA_INVALID'],
    ['blank reviewer id', () => { const value = clone(RECEIPT); value.independent_review.receipt.reviewer_id = '   '; return value }, 'SCHEMA_INVALID'],
    ['missing review operator id', () => { const value = clone(RECEIPT); delete value.independent_review.receipt.operator_id; return value }, 'SCHEMA_INVALID'],
    ['blank review operator id', () => { const value = clone(RECEIPT); value.independent_review.receipt.operator_id = '   '; return value }, 'SCHEMA_INVALID'],
    ['empty sampled core coverage', () => { const value = clone(RECEIPT); value.independent_review.receipt.sampled_core_run_ids = []; return value }, 'SCHEMA_INVALID'],
    ['self review', () => { const value = clone(RECEIPT); value.independent_review.receipt.reviewer_id = value.packet.operator_id; return value }, 'REVIEW_INDEPENDENCE'],
    ['missing sampled hashes', () => { const value = clone(RECEIPT); value.independent_review.receipt.sampled_artifact_sha256 = []; return value }, 'REVIEW_SAMPLING'],
    ['unsigned review', () => { const value = clone(RECEIPT); value.independent_review.signature.value_base64 = ''; return value }, 'REVIEW_SIGNATURE'],
    ['packet review mismatch', () => { const value = clone(RECEIPT); value.independent_review.receipt.packet_sha256 = 'f'.repeat(64); return value }, 'REVIEW_BINDING'],
    ['contract review mismatch', () => { const value = clone(RECEIPT); value.independent_review.receipt.contract_sha256 = 'f'.repeat(64); return value }, 'REVIEW_BINDING'],
  ])('rejects %s', (_name, mutate, code) => {
    expectReason(validate(mutate()), code)
  })

  it.each(CONTRACT.core_journey as string[])('rejects a run missing the %s core step', step => {
    const receipt = clone(RECEIPT)
    receipt.packet.runs[0].journey = receipt.packet.runs[0].journey.filter((row: Json) => row.step !== step)
    expectReason(validate(receipt), 'CORE_JOURNEY')
  })

  it.each(['accepted_photos', 'leaks', 'hangs', 'context_loss_crashes'])('rejects negative %s telemetry', field => {
    const receipt = clone(RECEIPT)
    const rowId = field === 'accepted_photos' ? 'no_person_block' : 'sustained_session'
    const row = receipt.packet.matrix.find((entry: Json) => entry.device_class === 'iphone_safari' && entry.row_id === rowId)
    row.measurements[field] = -1
    expectReason(validate(receipt), 'TELEMETRY_NEGATIVE')
  })

  it('rejects a 300-second sustained-session claim bound to a five-second run', () => {
    const receipt = clone(RECEIPT)
    const run = receipt.packet.runs.find((row: Json) => row.run_id === 'fixture-iphone-warm')
    run.ended_at = '2026-07-21T11:00:05.000Z'
    expectReason(validate(receipt), 'SUSTAINED_DURATION')
  })

  it('rejects journey evidence captured outside the run interval', () => {
    const receipt = clone(RECEIPT)
    receipt.packet.runs[0].journey[0].captured_at = '2026-07-21T09:59:59.000Z'
    expectReason(validate(receipt), 'JOURNEY_TIME')
  })

  it('rejects every artifact captured outside its declared source run interval', () => {
    const receipt = clone(RECEIPT)
    receipt.packet.evidence.find((row: Json) => row.source_run_id === 'fixture-iphone-cold').captured_at = '2026-07-21T10:10:01.000Z'
    expectReason(validate(receipt), 'EVIDENCE_TIME')
  })

  it('applies the checked-in schema to nested values manual checks do not inspect', () => {
    const receipt = clone(RECEIPT)
    receipt.packet.runs[0].journey[0].views = ['Alice Smith']
    expectReason(validate(receipt), 'SCHEMA_VALIDATION')
  })

  it('fails closed when the checked-in schema uses an unsupported keyword', () => {
    const schema = clone(SCHEMA)
    schema.unevaluatedProperties = false
    expect(validateJsonWithSchema(clone(RECEIPT), schema)).toContainEqual(expect.objectContaining({ code: 'SCHEMA_UNSUPPORTED_KEYWORD' }))
  })

  it('rejects an independent review timestamp that predates collection completion', () => {
    const receipt = clone(RECEIPT)
    receipt.independent_review.receipt.reviewed_at = '2026-07-21T12:59:59.000Z'
    expectReason(validate(receipt), 'REVIEW_CHRONOLOGY')
  })

  it('requires the independent review to occur strictly after collection completion', () => {
    const receipt = clone(RECEIPT)
    receipt.independent_review.receipt.reviewed_at = receipt.packet.runs.at(-1).ended_at
    expectReason(validate(receipt), 'REVIEW_CHRONOLOGY')
  })

  it('rejects an independent review timestamp in the future', () => {
    const receipt = clone(RECEIPT)
    receipt.independent_review.receipt.reviewed_at = '2026-07-21T16:00:01.000Z'
    expectReason(validate(receipt), 'REVIEW_FUTURE')
  })

  it('uses the contract-declared four-component reviewer sampling algorithm', () => {
    const selected: string[] = []
    for (const deviceClass of ['iphone_safari', 'android_chrome']) {
      const candidates = RECEIPT.packet.matrix
        .filter((row: Json) => row.device_class === deviceClass && row.status === 'passed')
        .map((row: Json) => `${deviceClass}:${row.row_id}`)
        .sort()
      const matching = candidates.filter((key: string) => {
        const [, rowId] = key.split(':')
        const input = `${RECEIPT.packet.contract_sha256}|${RECEIPT.packet.packet_id}|${deviceClass}|${rowId}`
        return Number.parseInt(sha256(input).slice(0, 2), 16) % 2 === 0
      })
      selected.push(...[...new Set([
        ...candidates.filter((key: string) => key === `${deviceClass}:sustained_session`),
        ...(matching.length > 0 ? matching : candidates.slice(0, 1)),
      ])].sort())
    }
    expect(RECEIPT.independent_review.receipt.sampled_remaining_row_keys).toEqual(selected)
  })

  it('rejects a fixture packet when physical validation is requested', () => {
    expectReason(validate(clone(RECEIPT), { fixture: false }), 'PHYSICAL_MODE_REQUIRED')
  })

  it('rejects a test reviewer key during physical validation', () => {
    const receipt = clone(RECEIPT)
    receipt.packet.mode = 'physical'
    receipt.packet.fixture = false
    receipt.packet.test_mode = false
    for (const run of receipt.packet.runs) { run.device.physical_device = true; run.device.emulated = false }
    const result = validate(receipt, { fixture: false })
    expectReason(result, 'REVIEW_KEY_UNAPPROVED')
    expect(result.reason_codes).toContain('EVIDENCE_TYPE')
  })

  it('rejects repository-contained evidence roots in physical mode', () => {
    const { contract, contractBytes, receipt, releaseConfigurationReceipt } = physicalReceipt()
    expectReason(validate(receipt, { contract, contractBytes, evidenceRoot: ARTIFACTS, fixture: false, releaseConfigurationReceipt }), 'PHYSICAL_EVIDENCE_ROOT_INTERNAL')
  })

  it('rejects a physical evidence root that is an ancestor of the repository', () => {
    const { contract, contractBytes, receipt, releaseConfigurationReceipt } = physicalReceipt()
    expectReason(validate(receipt, { contract, contractBytes, evidenceRoot: resolve(ROOT, '..'), fixture: false, releaseConfigurationReceipt }), 'PHYSICAL_EVIDENCE_ROOT_INTERNAL')
  })

  it('requires physical reviewer authority from the exact release-configuration receipt', () => {
    const { contract, contractBytes, receipt, evidenceRoot, releaseConfigurationReceipt } = physicalReceipt()
    expectReason(validate(receipt, { contract, contractBytes, evidenceRoot, fixture: false }), 'REVIEW_KEYS_REQUIRED')
    const mismatched = { ...releaseConfigurationReceipt, configuration_hash: 'f'.repeat(64) }
    expectReason(validate(receipt, { contract, contractBytes, evidenceRoot, fixture: false, releaseConfigurationReceipt: mismatched }), 'REVIEW_KEYS_BINDING')
  })

  it.each([
    ['traversal', '../outside.txt', 'EVIDENCE_PATH'],
    ['absolute path', '/tmp/outside.txt', 'EVIDENCE_PATH'],
  ])('rejects %s evidence paths', (_name, path, code) => {
    const receipt = clone(RECEIPT)
    receipt.packet.evidence[0].relative_path = path
    expectReason(validate(receipt), code)
  })

  it('rejects missing, zero-byte, wrong-size, wrong-hash, wrong-MIME, and symlink artifacts', () => {
    const cases: Array<[string, (receipt: Json, root: string) => void]> = [
      ['EVIDENCE_MISSING', (receipt, root) => unlinkSync(join(root, receipt.packet.evidence[0].relative_path))],
      ['EVIDENCE_ZERO_BYTES', (receipt, root) => writeFileSync(join(root, receipt.packet.evidence[0].relative_path), '')],
      ['EVIDENCE_SIZE', receipt => { receipt.packet.evidence[0].byte_length += 1 }],
      ['EVIDENCE_HASH', receipt => { receipt.packet.evidence[0].sha256 = 'f'.repeat(64) }],
      ['EVIDENCE_MIME', receipt => { receipt.packet.evidence[0].media_type = 'image/png' }],
      ['EVIDENCE_SYMLINK', (receipt, root) => { const file = join(root, receipt.packet.evidence[0].relative_path); unlinkSync(file); symlinkSync(join(ARTIFACTS, receipt.packet.evidence[0].relative_path), file) }],
    ]
    for (const [code, mutate] of cases) {
      const receipt = clone(RECEIPT)
      const root = copiedArtifacts()
      mutate(receipt, root)
      expectReason(validate(receipt, { evidenceRoot: root }), code)
    }
  })

  it('rejects an evidence root that is itself a symlink', () => {
    const parent = mkdtempSync(join(tmpdir(), 'posture-device-root-'))
    temporaryDirectories.push(parent)
    const linkedRoot = join(parent, 'linked-root')
    symlinkSync(ARTIFACTS, linkedRoot, 'dir')
    expectReason(validate(clone(RECEIPT), { evidenceRoot: linkedRoot }), 'EVIDENCE_ROOT_SYMLINK')
  })

  it('never leaks absolute evidence-root paths through reason codes', () => {
    const secretPath = '/private/tmp/Alice-Smith-device-evidence-does-not-exist'
    const result = validate(clone(RECEIPT), { evidenceRoot: secretPath })
    expect(result.reason_codes).toContain('EVIDENCE_ROOT_MISSING')
    expect(result.reason_codes.every(code => /^[A-Z0-9_]+$/.test(code))).toBe(true)
    expect(JSON.stringify(result.reason_codes)).not.toContain(secretPath)
  })

  it('publishes an integer Chrome 150 floor with the official release-dashboard source', () => {
    expect(CONTRACT.published_at).toBe('2026-07-21')
    expect(CONTRACT.supported_device_classes.android_chrome.chrome_min_major).toBe(150)
    expect(CONTRACT.supported_device_classes.android_chrome.browser_floor_source.url).toBe('https://chromiumdash.appspot.com/releases?platform=Android')
  })

  it('documents every required physical CLI input and release reviewer-key authority', () => {
    for (const document of [CHECKLIST, RUNBOOK]) {
      expect(document).toContain('--release-configuration-receipt')
      expect(document).toContain('hg04_approved_reviewer_public_key_fingerprints')
      expect(document).toContain('--expected-configuration-hash')
    }
  })

  it('rejects unknown fields at every object boundary published by the JSON Schema', () => {
    const objectSchemas: Json[] = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (value === null || typeof value !== 'object') return
      const row = value as Json
      if (row.type === 'object') objectSchemas.push(row)
      Object.values(row).forEach(visit)
    }
    visit(SCHEMA)
    expect(objectSchemas.length).toBeGreaterThan(10)
    expect(objectSchemas.every(row => row.additionalProperties === false)).toBe(true)
  })
})
