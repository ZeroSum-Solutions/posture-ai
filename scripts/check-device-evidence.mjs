#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/i
const COMMIT = /^[a-f0-9]{40}$/i
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const DOTTED_VERSION = /^\d+(?:\.\d+)*$/
const DEVICE_CLASSES = ['iphone_safari', 'android_chrome']
const STEP_KEYS = ['step', 'captured_at', 'evidence_id', 'invitation_only', 'aal', 'consent_valid', 'views', 'replaced_view', 'score_completed', 'assessment_only', 'markings_visible', 'pdf_requested', 'pdf_opened_or_downloaded']
const FORBIDDEN_KEYS = new Set(['client_name', 'client_email', 'client_id', 'landmarks', 'posture_photo', 'subject_name'])
const VALIDATOR_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = resolve(dirname(VALIDATOR_PATH), '..')
const SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'docs/qa/device-evidence.schema.json')
const VALIDATOR_BYTES = readFileSync(VALIDATOR_PATH, 'utf8')
const SCHEMA_BYTES = readFileSync(SCHEMA_PATH, 'utf8')
const DEVICE_EVIDENCE_SCHEMA = JSON.parse(SCHEMA_BYTES)
const SUPPORTED_SCHEMA_KEYWORDS = new Set(['$schema', '$id', 'title', '$defs', '$ref', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'items', 'format', 'pattern', 'minItems', 'minLength', 'minimum'])

export function validateDeviceEvidence({ contract, contractBytes, receipt, evidenceRoot, expectedCommit, expectedConfigurationHash, releaseConfigurationReceipt, fixture = false, now = new Date().toISOString() } = {}) {
  const errors = []
  validateContract(contract, errors)
  for (const schemaError of validateJsonWithSchema(receipt, DEVICE_EVIDENCE_SCHEMA)) error(errors, schemaError.code, schemaError.message)
  validateShape(receipt, errors)
  rejectSubjectData(receipt, errors)
  const packet = object(receipt?.packet) ? receipt.packet : {}
  const contractHash = object(contract) && typeof contractBytes === 'string' ? sha256(contractBytes) : null

  if (typeof contractBytes !== 'string') error(errors, 'CONTRACT_BYTES_REQUIRED', 'validator requires the exact published contract bytes')

  if (packet.contract_id !== contract?.contract_id || packet.contract_sha256 !== contractHash) error(errors, 'CONTRACT_BINDING', 'packet does not bind the exact contract bytes')
  if (!COMMIT.test(expectedCommit ?? '') || packet.release?.commit !== expectedCommit) error(errors, 'COMMIT_MISMATCH', 'packet commit does not match --expected-commit')
  if (!SHA256.test(expectedConfigurationHash ?? '') || packet.release?.configuration_hash !== expectedConfigurationHash) error(errors, 'CONFIGURATION_MISMATCH', 'packet configuration does not match --expected-configuration-hash')
  if (fixture) {
    if (packet.mode !== 'fixture' || packet.fixture !== true || packet.test_mode !== true) error(errors, 'FIXTURE_MODE_REQUIRED', '--fixture accepts only unmistakably labeled fixture/test packets')
  } else if (packet.mode !== 'physical' || packet.fixture !== false || packet.test_mode !== false) {
    error(errors, 'PHYSICAL_MODE_REQUIRED', 'normal validation rejects fixture, test-mode, and emulated packets')
  }

  const approvedReviewerFingerprints = validateReviewerAuthority(packet, contract, releaseConfigurationReceipt, fixture, errors)
  const evidence = validateEvidence(packet, contract, evidenceRoot, fixture, errors)
  const runs = validateRuns(packet, contract, evidence, fixture, errors)
  const matrix = validateMatrix(packet, contract, evidence, runs, errors)
  const deterministicSamples = expectedSamples(packet, contract, evidence, runs, matrix)
  const collectionCompletedAt = latestCollectionTimestamp(packet)
  validateReview(receipt?.independent_review, packet, contractHash, deterministicSamples, approvedReviewerFingerprints, collectionCompletedAt, now, fixture, errors)

  const packetStructurallyValid = errors.length === 0
  return {
    task_id: 'HG-04',
    status: packetStructurallyValid ? 'PASS' : 'FAIL',
    commit: packet.release?.commit ?? null,
    configuration_hash: packet.release?.configuration_hash ?? null,
    contract_sha256: packet.contract_sha256 ?? null,
    validator_sha256: sha256(VALIDATOR_BYTES),
    schema_sha256: sha256(SCHEMA_BYTES),
    packet_sha256: object(packet) ? sha256(stable(packet)) : null,
    evidence_root_manifest_sha256: packet.evidence_root_manifest_sha256 ?? null,
    mode: packet.mode ?? null,
    fixture: packet.fixture ?? null,
    test_mode: packet.test_mode ?? null,
    operator_id: packet.operator_id ?? null,
    approved_reviewer_public_key_fingerprints: fixture ? [] : approvedReviewerFingerprints,
    deterministic_samples: deterministicSamples,
    collection_completed_at: collectionCompletedAt,
    packet_structurally_valid: packetStructurallyValid,
    physical_packet_valid: packetStructurallyValid && !fixture && packet.mode === 'physical',
    hg04_launch_eligible: false,
    validator_is_necessary_not_sufficient: true,
    reason_codes: [...new Set(errors)],
  }
}

export function validateJsonWithSchema(value, schema) {
  const definitionErrors = []
  inspectSchemaNode(schema, '#', definitionErrors)
  if (definitionErrors.length > 0) return definitionErrors
  const validationErrors = []
  applySchemaNode(value, schema, schema, validationErrors)
  return validationErrors
}

function inspectSchemaNode(node, path, errors) {
  if (!object(node)) {
    errors.push({ code: 'SCHEMA_DEFINITION_INVALID', message: `${path} must be an object schema` })
    return
  }
  for (const keyword of Object.keys(node)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) errors.push({ code: 'SCHEMA_UNSUPPORTED_KEYWORD', message: `checked-in schema uses unsupported keyword ${keyword}` })
  }
  for (const container of ['$defs', 'properties']) {
    if (node[container] === undefined) continue
    if (!object(node[container])) errors.push({ code: 'SCHEMA_DEFINITION_INVALID', message: `${path}.${container} must be an object` })
    else for (const [key, child] of Object.entries(node[container])) inspectSchemaNode(child, `${path}.${container}.${key}`, errors)
  }
  if (node.items !== undefined) inspectSchemaNode(node.items, `${path}.items`, errors)
  if (node.$ref !== undefined && (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/'))) errors.push({ code: 'SCHEMA_DEFINITION_INVALID', message: `${path} contains a non-local $ref` })
  if (node.format !== undefined && node.format !== 'date-time') errors.push({ code: 'SCHEMA_UNSUPPORTED_KEYWORD', message: `checked-in schema uses unsupported format ${label(node.format)}` })
}

function applySchemaNode(value, node, root, errors) {
  if (typeof node.$ref === 'string') {
    const target = resolveSchemaRef(root, node.$ref)
    if (!object(target)) {
      errors.push({ code: 'SCHEMA_DEFINITION_INVALID', message: 'checked-in schema contains an unresolved local $ref' })
      return
    }
    applySchemaNode(value, target, root, errors)
  }
  if (node.const !== undefined && stable(value) !== stable(node.const)) errors.push(schemaViolation('const'))
  if (Array.isArray(node.enum) && !node.enum.some(candidate => stable(candidate) === stable(value))) errors.push(schemaViolation('enum'))
  const allowedTypes = Array.isArray(node.type) ? node.type : node.type === undefined ? [] : [node.type]
  if (allowedTypes.length > 0 && !allowedTypes.some(type => schemaTypeMatches(value, type))) {
    errors.push(schemaViolation('type'))
    return
  }
  if (typeof value === 'string') {
    if (Number.isInteger(node.minLength) && value.length < node.minLength) errors.push(schemaViolation('minLength'))
    if (typeof node.pattern === 'string') {
      try { if (!new RegExp(node.pattern).test(value)) errors.push(schemaViolation('pattern')) } catch { errors.push({ code: 'SCHEMA_DEFINITION_INVALID', message: 'checked-in schema contains an invalid pattern' }) }
    }
    if (node.format === 'date-time' && (!DATE.test(value) || !Number.isFinite(Date.parse(value)))) errors.push(schemaViolation('format'))
  }
  if (typeof value === 'number' && Number.isFinite(node.minimum) && value < node.minimum) errors.push(schemaViolation('minimum'))
  if (Array.isArray(value)) {
    if (Number.isInteger(node.minItems) && value.length < node.minItems) errors.push(schemaViolation('minItems'))
    if (object(node.items)) for (const item of value) applySchemaNode(item, node.items, root, errors)
  }
  if (object(value)) {
    const properties = object(node.properties) ? node.properties : {}
    for (const required of values(node.required)) if (!Object.hasOwn(value, required)) errors.push(schemaViolation('required'))
    if (node.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) errors.push(schemaViolation('additionalProperties'))
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) applySchemaNode(value[key], child, root, errors)
  }
}

function resolveSchemaRef(root, ref) {
  let cursor = root
  for (const token of ref.slice(2).split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) cursor = object(cursor) ? cursor[token] : undefined
  return cursor
}

function schemaTypeMatches(value, type) {
  if (type === 'object') return object(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

function schemaViolation(keyword) {
  return { code: 'SCHEMA_VALIDATION', message: `receipt violates checked-in schema keyword ${keyword}` }
}

function validateReviewerAuthority(packet, contract, receipt, fixture, errors) {
  if (fixture) return values(contract?.signature?.fixture_test_key_fingerprints)
  const fingerprints = values(receipt?.hg04_approved_reviewer_public_key_fingerprints)
  if (!object(receipt)
    || !exactObjectKeys(receipt, ['commit', 'configuration_hash', 'hg04_approved_reviewer_public_key_fingerprints'])
    || receipt.commit !== packet.release?.commit
    || receipt.configuration_hash !== packet.release?.configuration_hash) {
    error(errors, 'REVIEW_KEYS_BINDING', 'physical validation requires the exact release-configuration reviewer-key receipt')
  }
  if (fingerprints.length === 0 || new Set(fingerprints).size !== fingerprints.length || fingerprints.some(fingerprint => !SHA256.test(fingerprint))) {
    error(errors, 'REVIEW_KEYS_REQUIRED', 'physical validation requires at least one release-approved production reviewer fingerprint')
  }
  return fingerprints
}

function validateContract(contract, errors) {
  if (!object(contract)) return error(errors, 'CONTRACT_INVALID', 'contract must be an object')
  exactKeys(contract, ['contract_id', 'schema_version', 'published_at', 'release_binding', 'supported_device_classes', 'core_journey', 'required_views', 'matrix_rows', 'evidence', 'reviewer_sampling', 'signature', 'validator_semantics'], 'contract', errors)
  if (contract.schema_version !== 1 || contract.published_at !== '2026-07-21') error(errors, 'CONTRACT_VERSION', 'contract version or publication date is unsupported')
  const chrome = contract.supported_device_classes?.android_chrome
  if (!Number.isInteger(chrome?.chrome_min_major) || chrome.chrome_min_major !== 150) error(errors, 'CONTRACT_CHROME_FLOOR', 'Chrome floor must be the frozen integer 150')
  if (chrome?.browser_floor_source?.url !== 'https://chromiumdash.appspot.com/releases?platform=Android') error(errors, 'CONTRACT_CHROME_SOURCE', 'Chrome floor must cite the official release dashboard')
  const workoutAudio = values(contract.matrix_rows).find(row => row?.id === 'workout_audio')
  if (workoutAudio?.configuration_gate?.configuration_field !== 'workout_surface_enabled' || workoutAudio?.configuration_gate?.disabled_value !== false) error(errors, 'CONTRACT_CONFIGURATION_GATE', 'workout audio exclusion must bind the canonical disabled release flag')
  const wakeLock = values(contract.matrix_rows).find(row => row?.id === 'wake_lock')
  if (wakeLock?.capability_gate?.capability !== 'wake_lock') error(errors, 'CONTRACT_CAPABILITY_GATE', 'wake-lock exclusion must bind the canonical capability probe')
  if (contract.validator_semantics?.necessary_not_sufficient !== true || contract.validator_semantics?.hg04_launch_eligible_always_false !== true || contract.validator_semantics?.can_update_goal_state !== false) error(errors, 'CONTRACT_AUTHORITY', 'validator authority must remain necessary-not-sufficient and read-only')
}

function validateShape(receipt, errors) {
  if (!object(receipt)) return error(errors, 'SCHEMA_INVALID', 'receipt must be an object')
  exactKeys(receipt, ['schema_version', 'packet', 'independent_review'], 'receipt', errors)
  if (receipt.schema_version !== 1) error(errors, 'SCHEMA_VERSION', 'receipt schema_version must equal 1')
  const packet = receipt.packet
  if (!object(packet)) return error(errors, 'SCHEMA_INVALID', 'packet must be an object')
  exactKeys(packet, ['packet_id', 'task_id', 'contract_id', 'contract_sha256', 'mode', 'fixture', 'test_mode', 'operator_id', 'release', 'evidence_root_manifest_sha256', 'runs', 'matrix', 'evidence'], 'packet', errors)
  requiredStrings(packet, ['packet_id', 'contract_id', 'operator_id'], 'packet', errors)
  if (packet.task_id !== 'HG-04' || !SHA256.test(packet.contract_sha256 ?? '') || !SHA256.test(packet.evidence_root_manifest_sha256 ?? '')) error(errors, 'SCHEMA_INVALID', 'packet identifiers or hashes are malformed')
  exactKeys(packet.release, ['commit', 'configuration_hash'], 'packet.release', errors)
  if (!COMMIT.test(packet.release?.commit ?? '') || !SHA256.test(packet.release?.configuration_hash ?? '')) error(errors, 'SCHEMA_INVALID', 'release binding is malformed')
  for (const field of ['runs', 'matrix', 'evidence']) if (!Array.isArray(packet[field])) error(errors, 'SCHEMA_INVALID', `${field} must be an array`)
  for (const [index, run] of values(packet.runs).entries()) {
    exactKeys(run, ['run_id', 'device_class', 'challenge_nonce', 'started_at', 'ended_at', 'cache_profile', 'device', 'identity_evidence_id', 'core_recording_evidence_id', 'journey'], `runs[${index}]`, errors)
    requiredStrings(run, ['run_id', 'device_class', 'challenge_nonce', 'started_at', 'ended_at', 'cache_profile', 'identity_evidence_id', 'core_recording_evidence_id'], `runs[${index}]`, errors)
    exactKeys(run?.device, ['model', 'os_version', 'browser_name', 'browser_version', 'browser_build', 'physical_device', 'emulated', 'desktop', 'ram_gb', 'mid_or_low_tier'], `runs[${index}].device`, errors)
    requiredStrings(run?.device, ['model', 'os_version', 'browser_name', 'browser_version', 'browser_build'], `runs[${index}].device`, errors)
    if (!Array.isArray(run?.journey)) error(errors, 'SCHEMA_INVALID', `runs[${index}].journey must be an array`)
    for (const [stepIndex, step] of values(run?.journey).entries()) exactKeys(step, STEP_KEYS, `runs[${index}].journey[${stepIndex}]`, errors)
  }
  for (const [index, row] of values(packet.matrix).entries()) {
    exactKeys(row, ['device_class', 'row_id', 'status', 'run_id', 'evidence_id', 'reviewer_notes', 'applicability_proof', 'measurements'], `matrix[${index}]`, errors)
    requiredStrings(row, ['device_class', 'row_id', 'status', 'run_id', 'evidence_id', 'reviewer_notes'], `matrix[${index}]`, errors)
    if (row?.applicability_proof !== undefined) exactKeys(row.applicability_proof, ['kind', 'evidence_id', 'configuration_hash', 'configuration_field', 'configuration_value', 'capability', 'supported'], `matrix[${index}].applicability_proof`, errors)
    if (row?.measurements !== undefined) exactKeys(row.measurements, ['accepted_photos', 'duration_seconds', 'leaks', 'hangs', 'context_loss_crashes'], `matrix[${index}].measurements`, errors)
  }
  for (const [index, item] of values(packet.evidence).entries()) {
    exactKeys(item, ['evidence_id', 'relative_path', 'media_type', 'byte_length', 'sha256', 'captured_at', 'source_run_id', 'source_row'], `evidence[${index}]`, errors)
    requiredStrings(item, ['evidence_id', 'relative_path', 'media_type', 'sha256', 'captured_at', 'source_row'], `evidence[${index}]`, errors)
  }
  const review = receipt.independent_review
  exactKeys(review, ['receipt', 'signature'], 'independent_review', errors)
  exactKeys(review?.receipt, ['review_id', 'task_id', 'reviewer_id', 'operator_id', 'packet_sha256', 'contract_sha256', 'commit', 'configuration_hash', 'sampled_artifact_sha256', 'sampled_core_run_ids', 'sampled_device_classes', 'sampled_exclusion_keys', 'sampled_remaining_row_keys', 'reviewed_at', 'verdict'], 'independent_review.receipt', errors)
  requiredStrings(review?.receipt, ['review_id', 'task_id', 'reviewer_id', 'operator_id', 'packet_sha256', 'contract_sha256', 'commit', 'configuration_hash', 'reviewed_at', 'verdict'], 'independent_review.receipt', errors)
  for (const field of ['sampled_artifact_sha256', 'sampled_core_run_ids', 'sampled_device_classes', 'sampled_exclusion_keys', 'sampled_remaining_row_keys']) {
    if (!Array.isArray(review?.receipt?.[field]) || review.receipt[field].length === 0) error(errors, 'SCHEMA_INVALID', `independent_review.receipt.${field} must be a non-empty array`)
  }
  exactKeys(review?.signature, ['algorithm', 'key_class', 'public_key_pem', 'public_key_fingerprint', 'value_base64'], 'independent_review.signature', errors)
}

function validateEvidence(packet, contract, evidenceRoot, fixture, errors) {
  const rows = values(packet.evidence)
  const runs = new Map(values(packet.runs).filter(object).map(run => [run.run_id, run]))
  if (rows.length === 0) error(errors, 'EVIDENCE_EMPTY', 'evidence manifest is empty')
  const ids = uniqueMap(rows, 'evidence_id', 'EVIDENCE_ID_DUPLICATE', errors)
  const hashes = new Set()
  if (packet.evidence_root_manifest_sha256 !== sha256(stable(rows))) error(errors, 'EVIDENCE_MANIFEST_HASH', 'evidence manifest hash is stale')
  let rootReal = null
  try {
    if (lstatSync(evidenceRoot).isSymbolicLink()) error(errors, 'EVIDENCE_ROOT_SYMLINK', 'evidence root cannot be a symlink')
    rootReal = realpathSync(evidenceRoot)
    const repositoryReal = realpathSync(REPOSITORY_ROOT)
    if (!fixture && (within(repositoryReal, rootReal) || within(rootReal, repositoryReal))) error(errors, 'PHYSICAL_EVIDENCE_ROOT_INTERNAL', 'physical evidence root must be disjoint from the repository')
  } catch {
    error(errors, 'EVIDENCE_ROOT_MISSING', 'evidence root is missing')
  }
  for (const item of rows) {
    if (!object(item)) continue
    if (!SHA256.test(item.sha256 ?? '') || !Number.isInteger(item.byte_length) || item.byte_length < 1 || !DATE.test(item.captured_at ?? '')) error(errors, 'EVIDENCE_METADATA', `evidence ${label(item.evidence_id)} metadata is malformed`)
    const sourceRun = runs.get(item.source_run_id)
    const capturedAt = Date.parse(item.captured_at)
    if (!object(sourceRun) || !Number.isFinite(capturedAt) || capturedAt < Date.parse(sourceRun.started_at) || capturedAt > Date.parse(sourceRun.ended_at)) error(errors, 'EVIDENCE_TIME', `evidence ${label(item.evidence_id)} must be captured within its declared source run`)
    if (!values(contract?.evidence?.allowed_media_types).includes(item.media_type)) error(errors, 'EVIDENCE_MIME', `evidence ${label(item.evidence_id)} has a disallowed MIME type`)
    const sourceType = item.source_row === 'core_journey_recording' ? 'core_journey_recording' : item.source_row === 'device_identity' ? 'device_identity' : 'matrix_row'
    const sourceMediaTypes = fixture ? contract?.evidence?.fixture_media_types : contract?.evidence?.physical_media_types_by_source?.[sourceType]
    if (!values(sourceMediaTypes).includes(item.media_type)) error(errors, 'EVIDENCE_TYPE', `evidence ${label(item.evidence_id)} MIME type is not allowed for ${sourceType} in this mode`)
    if (hashes.has(item.sha256)) error(errors, 'EVIDENCE_HASH_REUSED', `evidence hash is reused by ${label(item.evidence_id)}`)
    hashes.add(item.sha256)
    if (!safeRelativePath(item.relative_path)) {
      error(errors, 'EVIDENCE_PATH', `evidence ${label(item.evidence_id)} path escapes the evidence root`)
      continue
    }
    if (!rootReal) continue
    const file = resolve(rootReal, item.relative_path)
    try {
      rejectSymlinkComponents(rootReal, file)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new EvidenceError('EVIDENCE_SYMLINK', 'artifact is not a regular non-symlink file')
      const real = realpathSync(file)
      if (!within(rootReal, real)) throw new EvidenceError('EVIDENCE_PATH', 'artifact resolves outside the evidence root')
      const bytes = readFileSync(real)
      if (bytes.length === 0) throw new EvidenceError('EVIDENCE_ZERO_BYTES', 'artifact is empty')
      if (bytes.length !== item.byte_length) throw new EvidenceError('EVIDENCE_SIZE', 'artifact byte length does not match metadata')
      if (sha256(bytes) !== item.sha256) throw new EvidenceError('EVIDENCE_HASH', 'artifact byte hash does not match metadata')
      if (detectMime(bytes) !== item.media_type) throw new EvidenceError('EVIDENCE_MIME', 'artifact bytes do not match declared MIME type')
      let artifactJson = null
      if (item.media_type === 'application/json') {
        try { artifactJson = JSON.parse(bytes.toString('utf8')) } catch { throw new EvidenceError('EVIDENCE_JSON', 'JSON artifact is malformed') }
      }
      ids.set(item.evidence_id, { ...item, artifact_json: artifactJson })
    } catch (cause) {
      const code = cause instanceof EvidenceError ? cause.code : 'EVIDENCE_MISSING'
      error(errors, code, `evidence ${label(item.evidence_id)}: ${cause instanceof Error ? cause.message : 'unreadable'}`)
    }
  }
  return ids
}

function validateRuns(packet, contract, evidence, fixture, errors) {
  const rows = values(packet.runs)
  const byId = uniqueMap(rows, 'run_id', 'RUN_ID_DUPLICATE', errors)
  const nonces = new Set()
  const coreEvidenceIds = new Set()
  const classIdentityEvidenceIds = new Set()
  const intervals = []
  for (const deviceClass of DEVICE_CLASSES) {
    const classRows = rows.filter(row => row?.device_class === deviceClass)
    if (classRows.length !== contract?.release_binding?.required_runs_per_class) error(errors, 'RUN_COUNT', `${deviceClass} requires exactly two runs`)
    if (!sameSet(classRows.map(row => row?.cache_profile), contract?.release_binding?.required_cache_profiles_per_class)) error(errors, 'CACHE_PROFILE', `${deviceClass} requires one cold and one warm run`)
    if (new Set(classRows.map(row => row?.identity_evidence_id)).size !== 1) error(errors, 'DEVICE_IDENTITY', `${deviceClass} must bind one exact selected device identity`)
    if (new Set(classRows.map(row => stable(row?.device))).size !== 1) error(errors, 'DEVICE_IDENTITY', `${deviceClass} runs must describe the same exact selected device`)
    if (classRows[0]?.identity_evidence_id) classIdentityEvidenceIds.add(classRows[0].identity_evidence_id)
  }
  if (classIdentityEvidenceIds.size !== DEVICE_CLASSES.length) error(errors, 'DEVICE_IDENTITY', 'each device class requires a distinct identity artifact')
  for (const row of rows) {
    if (!object(row)) continue
    if (!DEVICE_CLASSES.includes(row.device_class)) error(errors, 'DEVICE_CLASS', `unsupported device class ${label(row.device_class)}`)
    if (typeof row.challenge_nonce !== 'string' || row.challenge_nonce.length < 16 || nonces.has(row.challenge_nonce)) error(errors, 'RUN_NONCE', `run ${label(row.run_id)} challenge nonce is missing or reused`)
    nonces.add(row.challenge_nonce)
    const start = Date.parse(row.started_at)
    const end = Date.parse(row.ended_at)
    if (!DATE.test(row.started_at ?? '') || !DATE.test(row.ended_at ?? '') || !Number.isFinite(start) || start >= end) error(errors, 'RUN_TIME', `run ${label(row.run_id)} timestamps are invalid`)
    else intervals.push({ start, end, id: row.run_id })
    const identityEvidence = evidence.get(row.identity_evidence_id)
    const coreEvidence = evidence.get(row.core_recording_evidence_id)
    if (!identityEvidence || !coreEvidence || identityEvidence.source_row !== 'device_identity' || coreEvidence.source_run_id !== row.run_id || coreEvidence.source_row !== 'core_journey_recording') error(errors, 'RUN_EVIDENCE', `run ${label(row.run_id)} lacks correctly sourced identity or core recording evidence`)
    const expectedIdentity = { device_class: row.device_class, ...row.device }
    if (!identityEvidence || stable(identityEvidence.artifact_json) !== stable(expectedIdentity)) error(errors, 'RUN_IDENTITY_CONTENT', `run ${label(row.run_id)} identity artifact does not match the exact declared device`)
    if (coreEvidenceIds.has(row.core_recording_evidence_id)) error(errors, 'RUN_EVIDENCE_REUSED', `run ${label(row.run_id)} reuses another run's core evidence`)
    coreEvidenceIds.add(row.core_recording_evidence_id)
    validateDevice(row, contract, fixture, errors)
    validateJourney(row, contract, evidence, errors)
  }
  intervals.sort((a, b) => a.start - b.start)
  for (let index = 1; index < intervals.length; index += 1) if (intervals[index].start < intervals[index - 1].end) error(errors, 'RUN_OVERLAP', `${intervals[index].id} overlaps another run`)
  return byId
}

function validateDevice(run, contract, fixture, errors) {
  const device = run.device ?? {}
  const floor = contract?.supported_device_classes?.[run.device_class]
  if (!DOTTED_VERSION.test(device.os_version ?? '') || !DOTTED_VERSION.test(device.browser_version ?? '') || !DOTTED_VERSION.test(device.browser_build ?? '')) error(errors, 'DEVICE_VERSION', `run ${label(run.run_id)} has a malformed OS, browser version, or browser build`)
  if (device.browser_name !== floor?.browser_name) error(errors, 'BROWSER_IDENTITY', `run ${label(run.run_id)} does not match the required browser identity`)
  if (fixture) {
    if (device.physical_device !== false || device.emulated !== true || device.desktop !== false) error(errors, 'FIXTURE_DEVICE', `fixture run ${label(run.run_id)} must be labeled emulated and non-physical`)
  } else if (device.physical_device !== true || device.emulated !== false || device.desktop !== false) error(errors, 'PHYSICAL_DEVICE', `run ${label(run.run_id)} is not a physical non-desktop device`)
  const osMajor = versionMajor(device.os_version)
  if (!Number.isInteger(osMajor) || osMajor < floor?.minimum_os_major) error(errors, 'OS_FLOOR', `run ${label(run.run_id)} is below the OS floor`)
  if (run.device_class === 'android_chrome') {
    if (versionMajor(device.browser_version) < floor.chrome_min_major) error(errors, 'BROWSER_FLOOR', `run ${label(run.run_id)} is below Chrome ${floor.chrome_min_major}`)
    if (!Number.isInteger(device.ram_gb) || device.ram_gb < floor.ram_gb_min || device.ram_gb > floor.ram_gb_max || device.mid_or_low_tier !== true) error(errors, 'ANDROID_ENVELOPE', `run ${label(run.run_id)} is not a 4-6 GB mid/low Android phone`)
  } else if (device.ram_gb !== null || device.mid_or_low_tier !== null) error(errors, 'DEVICE_IDENTITY', `iPhone run ${label(run.run_id)} has Android-only identity fields`)
}

function validateJourney(run, contract, evidence, errors) {
  const steps = values(run.journey)
  if (!sameArray(steps.map(row => row?.step), contract?.core_journey)) error(errors, 'CORE_JOURNEY', `run ${label(run.run_id)} does not contain the exact ordered core journey`)
  let last = Number.NEGATIVE_INFINITY
  const runStart = Date.parse(run.started_at)
  const runEnd = Date.parse(run.ended_at)
  for (const step of steps) {
    const capturedAt = Date.parse(step?.captured_at)
    if (!object(step) || !DATE.test(step.captured_at ?? '') || capturedAt < last || step.evidence_id !== run.core_recording_evidence_id || !evidence.has(step.evidence_id)) error(errors, 'JOURNEY_EVIDENCE', `run ${label(run.run_id)} has malformed, reused, or unordered journey evidence`)
    if (!Number.isFinite(capturedAt) || capturedAt < runStart || capturedAt > runEnd) error(errors, 'JOURNEY_TIME', `run ${label(run.run_id)} journey evidence falls outside its run interval`)
    last = capturedAt
  }
  const byStep = new Map(steps.map(row => [row?.step, row]))
  if (byStep.get('practitioner_sign_in')?.invitation_only !== true || byStep.get('practitioner_sign_in')?.aal !== 'AAL2') error(errors, 'SIGN_IN_STEP', `run ${label(run.run_id)} lacks invitation-only AAL2 proof`)
  if (byStep.get('valid_consent')?.consent_valid !== true) error(errors, 'CONSENT_STEP', `run ${label(run.run_id)} lacks valid consent proof`)
  if (!sameSet(byStep.get('four_view_capture')?.views, contract?.required_views)) error(errors, 'CAPTURE_VIEWS', `run ${label(run.run_id)} lacks all four views`)
  if (!values(contract?.required_views).includes(byStep.get('retake')?.replaced_view)) error(errors, 'RETAKE_STEP', `run ${label(run.run_id)} lacks an identified retake`)
  if (byStep.get('score_completion')?.score_completed !== true) error(errors, 'SCORE_STEP', `run ${label(run.run_id)} lacks score completion`)
  if (byStep.get('assessment_results')?.assessment_only !== true || byStep.get('assessment_results')?.markings_visible !== true) error(errors, 'RESULTS_STEP', `run ${label(run.run_id)} lacks assessment-only results and markings`)
  if (byStep.get('pdf_open_or_download')?.pdf_requested !== true || byStep.get('pdf_open_or_download')?.pdf_opened_or_downloaded !== true) error(errors, 'PDF_STEP', `run ${label(run.run_id)} lacks successful PDF behavior`)
}

function validateMatrix(packet, contract, evidence, runs, errors) {
  const rows = values(packet.matrix)
  const byKey = new Map()
  for (const row of rows) {
    const key = `${row?.device_class}:${row?.row_id}`
    if (byKey.has(key)) error(errors, 'MATRIX_DUPLICATE', `duplicate matrix row ${key}`)
    byKey.set(key, row)
  }
  for (const deviceClass of DEVICE_CLASSES) for (const definition of values(contract?.matrix_rows)) {
    const key = `${deviceClass}:${definition.id}`
    const row = byKey.get(key)
    if (!object(row)) {
      error(errors, 'MATRIX_ROW_MISSING', `missing matrix row ${key}`)
      continue
    }
    const item = evidence.get(row.evidence_id)
    if (!runs.has(row.run_id) || runs.get(row.run_id)?.device_class !== deviceClass || !item || item.source_run_id !== row.run_id || item.source_row !== row.row_id) error(errors, 'MATRIX_EVIDENCE', `matrix row ${key} is not bound to a correctly sourced same-class run and artifact`)
    if (row.status === 'not_applicable') validateExclusion(row, definition, packet, evidence, key, errors)
    else if (row.status !== 'passed') error(errors, 'MATRIX_STATUS', `matrix row ${key} has invalid status`)
    if (row.status === 'passed') validateThresholds(row, definition, key, runs, errors)
  }
  if (byKey.size !== DEVICE_CLASSES.length * values(contract?.matrix_rows).length) error(errors, 'MATRIX_EXTRA', 'matrix contains unknown rows or device classes')
  return byKey
}

function validateExclusion(row, definition, packet, evidence, key, errors) {
  if (definition.classification === 'required') return error(errors, 'CORE_NOT_APPLICABLE', `required row ${key} cannot be not_applicable`)
  const proof = row.applicability_proof
  if (!object(proof) || !values(definition.allowed_not_applicable_proofs).includes(proof.kind) || !evidence.has(proof.evidence_id) || proof.evidence_id !== row.evidence_id) return error(errors, 'EXCLUSION_PROOF', `optional row ${key} lacks its objective proof`)
  if (proof.kind === 'release_configuration_disabled') {
    const gate = definition.configuration_gate
    const artifact = evidence.get(proof.evidence_id)?.artifact_json
    if (!object(gate)
      || gate.configuration_field !== 'workout_surface_enabled'
      || gate.disabled_value !== false
      || proof.configuration_hash !== packet.release.configuration_hash
      || proof.configuration_field !== gate.configuration_field
      || proof.configuration_value !== gate.disabled_value) {
      error(errors, 'EXCLUSION_CONFIGURATION', `row ${key} does not bind the canonical disabled release flag`)
    }
    if (!object(artifact)
      || !exactObjectKeys(artifact, ['device_class', 'run_id', 'configuration_hash', 'configuration_field', 'configuration_value'])
      || artifact.device_class !== row.device_class
      || artifact.run_id !== row.run_id
      || artifact.configuration_hash !== proof.configuration_hash
      || artifact.configuration_field !== proof.configuration_field
      || artifact.configuration_value !== proof.configuration_value) {
      error(errors, 'EXCLUSION_PROOF_CONTENT', `row ${key} configuration proof bytes do not match the exact release flag assertion`)
    }
  }
  if (proof.kind === 'unsupported_capability_probe') {
    const gate = definition.capability_gate
    const artifact = evidence.get(proof.evidence_id)?.artifact_json
    if (gate?.capability !== 'wake_lock' || proof.capability !== gate.capability || proof.supported !== false) error(errors, 'EXCLUSION_CAPABILITY', `row ${key} does not bind the canonical unsupported capability`)
    if (!object(artifact)
      || !exactObjectKeys(artifact, ['device_class', 'run_id', 'capability', 'supported'])
      || artifact.device_class !== row.device_class
      || artifact.run_id !== row.run_id
      || artifact.capability !== proof.capability
      || artifact.supported !== proof.supported) {
      error(errors, 'EXCLUSION_CAPABILITY_CONTENT', `row ${key} capability proof bytes do not match its device and run`)
    }
  }
}

function validateThresholds(row, definition, key, runs, errors) {
  const limits = definition.thresholds
  if (!object(limits)) return
  const measurements = row.measurements
  if (!object(measurements)) return error(errors, 'TELEMETRY_MISSING', `threshold row ${key} lacks measurements`)
  for (const [field, value] of Object.entries(measurements)) if (!Number.isInteger(value) || value < 0) error(errors, 'TELEMETRY_NEGATIVE', `${key} ${field} must be a non-negative integer`)
  if (Number.isInteger(limits.accepted_photos_max) && (!Number.isInteger(measurements.accepted_photos) || measurements.accepted_photos > limits.accepted_photos_max)) error(errors, 'TELEMETRY_THRESHOLD', `${key} accepted photos exceed the threshold`)
  if (Number.isInteger(limits.minimum_duration_seconds) && (!Number.isInteger(measurements.duration_seconds) || measurements.duration_seconds < limits.minimum_duration_seconds)) error(errors, 'TELEMETRY_THRESHOLD', `${key} duration is below the threshold`)
  for (const field of ['leaks', 'hangs', 'context_loss_crashes']) if (Number.isInteger(limits[`${field}_max`]) && (!Number.isInteger(measurements[field]) || measurements[field] > limits[`${field}_max`])) error(errors, 'TELEMETRY_THRESHOLD', `${key} ${field} exceed the threshold`)
  if (definition.id === 'sustained_session') {
    const run = runs.get(row.run_id)
    const actualDurationSeconds = (Date.parse(run?.ended_at) - Date.parse(run?.started_at)) / 1000
    if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds < limits.minimum_duration_seconds || measurements.duration_seconds > actualDurationSeconds) error(errors, 'SUSTAINED_DURATION', `${key} duration claim exceeds its bound run interval or contract minimum`)
  }
}

function validateReview(review, packet, contractHash, expected, approvedReviewerFingerprints, collectionCompletedAt, now, fixture, errors) {
  const receipt = review?.receipt
  const signature = review?.signature
  if (!object(receipt) || !object(signature)) return error(errors, 'REVIEW_MISSING', 'independent review and detached signature are required')
  if (receipt.task_id !== 'HG-04' || receipt.verdict !== 'PASS' || receipt.reviewer_id === packet.operator_id || receipt.operator_id !== packet.operator_id) error(errors, 'REVIEW_INDEPENDENCE', 'reviewer must differ from and bind the operator')
  if (receipt.packet_sha256 !== sha256(stable(packet)) || receipt.contract_sha256 !== contractHash || receipt.commit !== packet.release?.commit || receipt.configuration_hash !== packet.release?.configuration_hash) error(errors, 'REVIEW_BINDING', 'review is stale or bound to a different packet, contract, commit, or configuration')
  if (!DATE.test(receipt.reviewed_at ?? '')) error(errors, 'REVIEW_TIMESTAMP', 'review timestamp is malformed')
  const reviewedAt = Date.parse(receipt.reviewed_at)
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(Date.parse(collectionCompletedAt)) || reviewedAt <= Date.parse(collectionCompletedAt)) error(errors, 'REVIEW_CHRONOLOGY', 'independent review must occur after collection completion')
  if (!Number.isFinite(Date.parse(now)) || reviewedAt > Date.parse(now)) error(errors, 'REVIEW_FUTURE', 'independent review cannot occur in the future')
  for (const [field, valuesExpected] of Object.entries(expected.fields)) if (!sameSet(receipt[field], valuesExpected)) error(errors, 'REVIEW_SAMPLING', `${field} does not match deterministic required sampling`)
  if (!sameSet(receipt.sampled_artifact_sha256, expected.hashes)) error(errors, 'REVIEW_SAMPLING', 'sampled artifact hashes do not cover all required samples')
  if (signature.algorithm !== 'Ed25519' || !['test', 'production'].includes(signature.key_class)) error(errors, 'REVIEW_SIGNATURE', 'signature algorithm or key class is invalid')
  try {
    const key = createPublicKey(signature.public_key_pem)
    const fingerprint = sha256(key.export({ type: 'spki', format: 'der' }))
    if (fingerprint !== signature.public_key_fingerprint) error(errors, 'REVIEW_KEY_FINGERPRINT', 'public key fingerprint does not match key bytes')
    if (!values(approvedReviewerFingerprints).includes(fingerprint) || (fixture ? signature.key_class !== 'test' : signature.key_class !== 'production')) error(errors, 'REVIEW_KEY_UNAPPROVED', 'review key is not approved for this validation mode')
    if (!verifySignature(null, Buffer.from(stable(receipt)), key, Buffer.from(signature.value_base64 ?? '', 'base64'))) error(errors, 'REVIEW_SIGNATURE', 'detached Ed25519 signature is invalid')
  } catch {
    error(errors, 'REVIEW_SIGNATURE', 'detached Ed25519 signature or public key is malformed')
  }
}

function expectedSamples(packet, contract, evidence, runs, matrix) {
  const runRows = [...runs.values()]
  const coreIds = runRows.map(row => row.core_recording_evidence_id)
  const identityIds = [...new Set(runRows.map(row => row.identity_evidence_id))]
  const exclusions = [...matrix.entries()].filter(([, row]) => row.status === 'not_applicable').map(([key, row]) => ({ key, evidenceId: row.evidence_id }))
  const remaining = []
  for (const deviceClass of DEVICE_CLASSES) {
    const candidates = [...matrix.entries()].filter(([key, row]) => key.startsWith(`${deviceClass}:`) && row.status === 'passed').sort(([a], [b]) => a.localeCompare(b))
    const mandatory = candidates.filter(([key]) => key === `${deviceClass}:sustained_session`)
    let selected = candidates.filter(([key]) => {
      const rowId = key.slice(deviceClass.length + 1)
      return Number.parseInt(sha256(`${packet.contract_sha256}|${packet.packet_id}|${deviceClass}|${rowId}`).slice(0, 2), 16) % 2 === 0
    })
    if (selected.length < contract.reviewer_sampling.minimum_remaining_rows_per_class) selected = candidates.slice(0, contract.reviewer_sampling.minimum_remaining_rows_per_class)
    const selectedByKey = new Map([...mandatory, ...selected].map(([key, row]) => [key, row]))
    remaining.push(...[...selectedByKey].sort(([left], [right]) => left.localeCompare(right)).map(([key, row]) => ({ key, evidenceId: row.evidence_id })))
  }
  const evidenceIds = [...coreIds, ...identityIds, ...exclusions.map(row => row.evidenceId), ...remaining.map(row => row.evidenceId)]
  return {
    hashes: [...new Set(evidenceIds.map(id => evidence.get(id)?.sha256).filter(Boolean))],
    fields: {
      sampled_core_run_ids: runRows.map(row => row.run_id),
      sampled_device_classes: DEVICE_CLASSES,
      sampled_exclusion_keys: exclusions.map(row => row.key),
      sampled_remaining_row_keys: remaining.map(row => row.key),
    },
  }
}

function rejectSubjectData(value, errors) {
  if (Array.isArray(value)) return value.forEach(row => rejectSubjectData(row, errors))
  if (!object(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) error(errors, 'SUBJECT_DATA_FORBIDDEN', `forbidden subject-data field ${key}`)
    rejectSubjectData(child, errors)
  }
}

function exactKeys(value, allowed, path, errors) {
  if (!object(value)) return error(errors, 'SCHEMA_INVALID', `${path} must be an object`)
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length) error(errors, 'SCHEMA_UNKNOWN_FIELD', `${path} contains unknown field(s): ${extras.join(', ')}`)
}

function exactObjectKeys(value, allowed) {
  return object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key))
}

function requiredStrings(value, fields, path, errors) {
  for (const field of fields) if (typeof value?.[field] !== 'string' || value[field].trim().length === 0) error(errors, 'SCHEMA_INVALID', `${path}.${field} must be a non-empty string`)
}

function uniqueMap(rows, key, code, errors) {
  const result = new Map()
  for (const row of rows) {
    const value = row?.[key]
    if (typeof value !== 'string' || value.length === 0 || result.has(value)) error(errors, code, `${key} ${label(value)} is missing or duplicated`)
    else result.set(value, row)
  }
  return result
}

function rejectSymlinkComponents(root, file) {
  const rel = relative(root, file)
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = resolve(cursor, part)
    if (lstatSync(cursor).isSymbolicLink()) throw new EvidenceError('EVIDENCE_SYMLINK', 'artifact path contains a symlink')
  }
}

function detectMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp') return 'video/mp4'
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm'
  const text = bytes.toString('utf8')
  if (!text.includes('\uFFFD') && !text.includes('\0')) {
    try { JSON.parse(text); return 'application/json' } catch { return 'text/plain' }
  }
  return 'application/octet-stream'
}

function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) return false
  const normalized = path.replaceAll('\\', '/')
  return !normalized.includes('\0') && !normalized.split('/').includes('..')
}

function within(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function values(value) { return Array.isArray(value) ? value : [] }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function sameArray(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]) }
function sameSet(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value)) }
function latestCollectionTimestamp(packet) {
  const timestamps = [
    ...values(packet?.runs).map(run => Date.parse(run?.ended_at)),
    ...values(packet?.evidence).map(item => Date.parse(item?.captured_at)),
  ].filter(Number.isFinite)
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null
}
function versionMajor(value) { return DOTTED_VERSION.test(String(value ?? '')) ? Number(String(value).split('.')[0]) : null }
function label(value) { return typeof value === 'string' && value.length ? value : '<missing>' }
function error(errors, code) { errors.push(code) }

class EvidenceError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function parseArgs(argv) {
  const options = { fixture: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--fixture') options.fixture = true
    else if (arg.startsWith('--')) options[arg.slice(2).replaceAll('-', '_')] = argv[++index]
  }
  return options
}

function runCli() {
  const args = parseArgs(process.argv.slice(2))
  try {
    const receipt = JSON.parse(readFileSync(args.receipt, 'utf8'))
    const contractBytes = readFileSync(args.contract, 'utf8')
    const result = validateDeviceEvidence({
      contract: JSON.parse(contractBytes),
      contractBytes,
      receipt,
      evidenceRoot: args.evidence_root,
      expectedCommit: args.expected_commit ?? (args.fixture ? receipt?.packet?.release?.commit : undefined),
      expectedConfigurationHash: args.expected_configuration_hash ?? (args.fixture ? receipt?.packet?.release?.configuration_hash : undefined),
      releaseConfigurationReceipt: args.release_configuration_receipt ? JSON.parse(readFileSync(args.release_configuration_receipt, 'utf8')) : undefined,
      fixture: args.fixture,
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.status === 'PASS' ? 0 : 1
  } catch (cause) {
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', packet_structurally_valid: false, physical_packet_valid: false, hg04_launch_eligible: false, validator_is_necessary_not_sufficient: true, reason_codes: [`INPUT_INVALID: ${cause instanceof Error ? cause.message : 'unknown error'}`] }, null, 2)}\n`)
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) runCli()
