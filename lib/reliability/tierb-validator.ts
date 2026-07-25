import {
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  TIER_B_ANALYSIS_VERSION,
  TIER_B_CAPTURE_SLOTS,
  TIER_B_METRIC_REGISTRY,
  TIER_B_PROTOCOL_VERSION,
  TIER_B_PUBLIC_ENVELOPE_VERSION,
  TIER_B_REPEAT_IDS,
  TIER_B_RESTRICTED_ENVELOPE_VERSION,
  TIER_B_TRUST_POLICY_VERSION,
  TIER_B_VIEWS,
} from '../pose/tierb-contract'
import {
  assessPosture,
  ENGINE_VERSION,
} from '../../packages/posture-engine/src/engine'
import type { PoseFrame } from '../../packages/posture-engine/src/types'
import {
  canonicalizeTierB,
  parseCanonicalTierBJson,
  sha256TierB,
  sha256TierBBytes,
  type TierBSha256,
} from './tierb-canonical'
import {
  analyzeTierBReliability,
  type TierBAnalysisInput,
} from './tierb-analysis'

const TIER_B_MAX_FRAMES_PER_ARTIFACT = 5

export type TierBState = 'prepared' | 'collection_authorized' | 'adjudicated'

export interface TierBTransition {
  context: {
    domain: 'POSTURE-AI-TIERB-AUTHORIZATION-V1' | 'POSTURE-AI-TIERB-ADJUDICATION-V1'
    packetId: string
    fromState: 'prepared' | 'collection_authorized'
    toState: 'collection_authorized' | 'adjudicated'
    repositoryCommit: string
    configurationSha256: TierBSha256
    parentPublicEnvelopeSha256: TierBSha256
    publicPayloadSha256: TierBSha256
    restrictedEnvelopeSha256: TierBSha256
  }
  signature: {
    algorithm: 'Ed25519'
    keyId: string
    signatureBase64: string
  }
}

export interface TierBPublicEnvelope {
  schemaVersion: typeof TIER_B_PUBLIC_ENVELOPE_VERSION
  packetId: string
  state: TierBState
  parentPublicEnvelopeSha256: TierBSha256 | null
  repositoryCommit: string | null
  configurationSha256: TierBSha256 | null
  restrictedEnvelopeSha256: TierBSha256 | null
  payload: unknown
  payloadSha256: TierBSha256
  transition: TierBTransition | null
}

export interface TierBRestrictedEnvelope {
  schemaVersion: typeof TIER_B_RESTRICTED_ENVELOPE_VERSION
  packetId: string
  state: Exclude<TierBState, 'prepared'>
  parentPublicEnvelopeSha256: TierBSha256
  privacyClass: 'restricted-local'
  payload: unknown
}

export interface TierBTrustPolicy {
  schemaVersion: typeof TIER_B_TRUST_POLICY_VERSION
  trustDomain: 'posture-ai-tierb-reliability'
  environment: 'production' | 'fixture'
  keys: Array<{
    keyId: string
    algorithm: 'Ed25519'
    roles: Array<'collection_owner' | 'statistical_reviewer'>
    publicKeySpkiDerBase64: string
    publicKeySha256: TierBSha256
    status: 'active' | 'revoked'
    validFrom: string
    validUntil: string
  }>
}

export type TierBRejectionCode =
  | 'SCHEMA_INVALID'
  | 'LIFECYCLE_MISMATCH'
  | 'STATE_TRANSITION_INVALID'
  | 'PARENT_ENVELOPE_HASH_MISMATCH'
  | 'PACKET_ID_MISMATCH'
  | 'PUBLIC_PRIVACY_FIELD_FORBIDDEN'
  | 'RESTRICTED_ENVELOPE_REQUIRED'
  | 'RESTRICTED_ENVELOPE_UNEXPECTED'
  | 'RESTRICTED_ENVELOPE_HASH_MISMATCH'
  | 'PREPARED_AUTHORIZATION_FORBIDDEN'
  | 'PREPARED_ELIGIBILITY_FORBIDDEN'
  | 'PREPARED_PROVENANCE_FORBIDDEN'
  | 'PREPARED_SIGNING_KEYS_FORBIDDEN'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'ANALYSIS_VERSION_MISMATCH'
  | 'TRUST_POLICY_HASH_MISMATCH'
  | 'TRUST_KEY_NOT_FOUND'
  | 'TRUST_KEY_ROLE_MISMATCH'
  | 'TRUST_KEY_INACTIVE'
  | 'TRUST_KEY_EXPIRED'
  | 'TRUST_KEY_FINGERPRINT_MISMATCH'
  | 'SIGNER_SEPARATION_REQUIRED'
  | 'HASH_MISMATCH'
  | 'SIGNATURE_CONTEXT_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'FROZEN_PROVENANCE_INCOMPLETE'
  | 'DEVICE_SET_INVALID'
  | 'OPERATOR_SET_INVALID'
  | 'SCHEDULE_INVALID'
  | 'MANIFEST_CELL_SET_MISMATCH'
  | 'MANIFEST_DUPLICATE_ROW'
  | 'MANIFEST_DUPLICATE_PHOTO'
  | 'MANIFEST_SCHEDULE_MISMATCH'
  | 'ARTIFACT_PATH_INVALID'
  | 'ARTIFACT_SYMLINK'
  | 'ARTIFACT_NOT_REGULAR'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'ARTIFACT_MIME_MISMATCH'
  | 'ARTIFACT_CHANGED_DURING_READ'
  | 'ARTIFACT_CANONICAL_BYTES_MISMATCH'
  | 'ARTIFACT_READER_REQUIRED'
  | 'ROW_BINDING_MISMATCH'
  | 'VIEW_PROFILE_MISMATCH'
  | 'ANALYSIS_CONTRACT_INVALID'
  | 'PROFILE_ELIGIBILITY_INVALID'

export interface TierBValidationError {
  code: TierBRejectionCode
  path: string
  message: string
}

export type TierBValidationResult = {
  ok: boolean
  state: TierBState | null
  collectionAuthorized: boolean
  consumerEligible: boolean
  errors: TierBValidationError[]
}

export type TierBArtifactMime = 'image/jpeg' | 'image/png' | 'application/json'

export interface TierBArtifactExpectation {
  path: string
  sha256: TierBSha256
  byteLength: number
  mime: TierBArtifactMime
}

export interface TierBVerifiedArtifact {
  bytes: Uint8Array
  sha256: TierBSha256
  byteLength: number
  mime: TierBArtifactMime
  device: number | bigint
  inode: number | bigint
}

export interface TierBArtifactReader {
  readVerified(expected: TierBArtifactExpectation): TierBVerifiedArtifact
}

export class TierBArtifactVerificationError extends Error {
  constructor(
    readonly code:
      | 'ARTIFACT_PATH_INVALID'
      | 'ARTIFACT_SYMLINK'
      | 'ARTIFACT_NOT_REGULAR'
      | 'ARTIFACT_HASH_MISMATCH'
      | 'ARTIFACT_MIME_MISMATCH'
      | 'ARTIFACT_CHANGED_DURING_READ'
      | 'ARTIFACT_CANONICAL_BYTES_MISMATCH',
    message: string,
  ) {
    super(message)
  }
}

type EnvelopeInput = {
  publicEnvelope: TierBPublicEnvelope
  restrictedEnvelope?: TierBRestrictedEnvelope
}

export interface ValidateTierBChainInput {
  envelopes: EnvelopeInput[]
  trustPolicy: TierBTrustPolicy
  expectedTrustPolicySha256: TierBSha256
  expectedTrustPolicyEnvironment?: TierBTrustPolicy['environment']
  expectedState: TierBState
  now: string
  artifactReader?: TierBArtifactReader
}

const SHA256 = /^sha256:[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const CLUSTER_ID = /^cluster-[0-9]{2}$/
const PRIVACY_FIELDS = new Set([
  'participantId',
  'participantIds',
  'participantMapping',
  'consent',
  'consentReceiptId',
  'sourcePhoto',
  'landmarks',
  'localPath',
  'rows',
  'excludedParticipants',
  'capturedAt',
  'captureTimestamp',
  'timestamp',
  'userAgent',
  'rawUserAgent',
  'deviceSerial',
  'serialNumber',
  'exif',
  'gps',
  'latitude',
  'longitude',
  'originalFilename',
  'sourceFilename',
  'rawPhotoHash',
  'photoSha256',
])

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function add(
  errors: TierBValidationError[],
  code: TierBRejectionCode,
  path: string,
  message: string,
) {
  errors.push({ code, path, message })
}

function scanPublicPrivacy(
  value: unknown,
  path: string,
  errors: TierBValidationError[],
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanPublicPrivacy(entry, `${path}/${index}`, errors))
    return
  }
  if (!object(value)) return
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}/${key}`
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase()
    const explicitlyForbidden = [...PRIVACY_FIELDS].some(
      (candidate) => candidate.replace(/[-_]/g, '').toLowerCase() === normalizedKey,
    )
    if (explicitlyForbidden) {
      add(errors, 'PUBLIC_PRIVACY_FIELD_FORBIDDEN', entryPath, `${key} is restricted evidence`)
    }
    scanPublicPrivacy(entry, entryPath, errors)
  }
}

function same(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeTierB(left) === canonicalizeTierB(right)
  } catch {
    return false
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function boundedPublicText(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && /^[\x20-\x7e]+$/.test(value)
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return object(value)
    && same(Object.keys(value).sort(), [...keys].sort())
}

function signatureMessage(context: TierBTransition['context']): Buffer {
  const { domain, ...bound } = context
  return Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from([0]),
    Buffer.from(canonicalizeTierB(bound), 'utf8'),
  ])
}

function validArtifactRef(value: unknown): boolean {
  return object(value)
    && nonEmpty(value.path)
    && SHA256.test(String(value.sha256 ?? ''))
}

function safeRelativeArtifactPath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes('\0') || path.includes('\\')) return false
  const parts = path.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function validPng(bytes: Uint8Array): boolean {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 45 || !Buffer.from(bytes.subarray(0, 8)).equals(signature)) return false
  let offset = 8
  let chunkIndex = 0
  let sawIdat = false
  while (offset + 12 <= bytes.length) {
    const length = Buffer.from(bytes.subarray(offset, offset + 4)).readUInt32BE(0)
    const end = offset + 12 + length
    if (end > bytes.length) return false
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = Buffer.from(typeBytes).toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = Buffer.from(bytes.subarray(offset + 8 + length, end)).readUInt32BE(0)
    if (!/^[A-Za-z]{4}$/.test(type)
      || crc32(Buffer.concat([Buffer.from(typeBytes), Buffer.from(data)])) !== expectedCrc) {
      return false
    }
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) return false
    if (type === 'IDAT') sawIdat = true
    if (type === 'IEND') return length === 0 && sawIdat && end === bytes.length
    offset = end
    chunkIndex += 1
  }
  return false
}

function validJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false
  let offset = 2
  let sawFrame = false
  let sawScan = false
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return false
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9) return sawFrame && sawScan && offset === bytes.length
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      return false
    }
    if (offset + 2 > bytes.length) return false
    const segmentLength = Buffer.from(bytes.subarray(offset, offset + 2)).readUInt16BE(0)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false
    if ((marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)) {
      sawFrame = true
    }
    offset += segmentLength
    if (marker !== 0xda) continue
    sawScan = true
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const markerOffset = offset
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.length) return false
      const scanMarker = bytes[offset]
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset += 1
        continue
      }
      offset = markerOffset
      break
    }
  }
  return false
}

export function detectTierBArtifactMime(bytes: Uint8Array): TierBArtifactMime | null {
  if (validJpeg(bytes)) return 'image/jpeg'
  if (validPng(bytes)) return 'image/png'
  try {
    parseCanonicalTierBJson(Buffer.from(bytes).toString('utf8'))
    return 'application/json'
  } catch {
    return null
  }
}

function unchangedFile(
  before: ReturnType<typeof fstatSync>,
  after: ReturnType<typeof fstatSync>,
): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs
}

export function createNodeTierBArtifactReader(root: string): TierBArtifactReader {
  if (lstatSync(root).isSymbolicLink()) {
    throw new TierBArtifactVerificationError('ARTIFACT_SYMLINK', 'artifact root cannot be a symlink')
  }
  const canonicalRoot = realpathSync(root)
  if (!lstatSync(canonicalRoot).isDirectory()) {
    throw new TierBArtifactVerificationError('ARTIFACT_PATH_INVALID', 'artifact root must be a directory')
  }
  return {
    readVerified(expected) {
      if (!safeRelativeArtifactPath(expected.path)) {
        throw new TierBArtifactVerificationError('ARTIFACT_PATH_INVALID', `unsafe artifact path ${expected.path}`)
      }
      const parts = expected.path.split('/')
      let cursor = canonicalRoot
      for (const part of parts) {
        cursor = resolve(cursor, part)
        const rel = relative(canonicalRoot, cursor)
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          throw new TierBArtifactVerificationError('ARTIFACT_PATH_INVALID', `artifact escapes root: ${expected.path}`)
        }
        if (lstatSync(cursor).isSymbolicLink()) {
          throw new TierBArtifactVerificationError('ARTIFACT_SYMLINK', `artifact path contains a symlink: ${expected.path}`)
        }
      }
      const canonicalTarget = realpathSync(cursor)
      const rel = relative(canonicalRoot, canonicalTarget)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new TierBArtifactVerificationError('ARTIFACT_PATH_INVALID', `artifact resolves outside root: ${expected.path}`)
      }

      const descriptor = openSync(canonicalTarget, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
      try {
        const before = fstatSync(descriptor)
        if (!before.isFile()) {
          throw new TierBArtifactVerificationError('ARTIFACT_NOT_REGULAR', `artifact is not a regular file: ${expected.path}`)
        }
        const bytes = readFileSync(descriptor)
        const after = fstatSync(descriptor)
        if (!unchangedFile(before, after)) {
          throw new TierBArtifactVerificationError('ARTIFACT_CHANGED_DURING_READ', `artifact changed while being read: ${expected.path}`)
        }
        const sha256 = sha256TierBBytes(bytes)
        if (sha256 !== expected.sha256 || bytes.byteLength !== expected.byteLength) {
          throw new TierBArtifactVerificationError('ARTIFACT_HASH_MISMATCH', `artifact bytes do not match manifest: ${expected.path}`)
        }
        const mime = detectTierBArtifactMime(bytes)
        if (mime !== expected.mime) {
          const code = expected.mime === 'application/json'
            ? 'ARTIFACT_CANONICAL_BYTES_MISMATCH'
            : 'ARTIFACT_MIME_MISMATCH'
          throw new TierBArtifactVerificationError(code, `artifact MIME or canonical JSON differs: ${expected.path}`)
        }
        return {
          bytes,
          sha256,
          byteLength: bytes.byteLength,
          mime,
          device: before.dev,
          inode: before.ino,
        }
      } finally {
        closeSync(descriptor)
      }
    },
  }
}

function validateTrustPolicy(policy: TierBTrustPolicy, errors: TierBValidationError[]) {
  if (!exactKeys(policy, ['schemaVersion', 'trustDomain', 'environment', 'keys'])) {
    add(errors, 'SCHEMA_INVALID', '/trustPolicy', 'trust policy has unknown or missing fields')
  }
  if (policy.environment !== 'production' && policy.environment !== 'fixture') {
    add(errors, 'SCHEMA_INVALID', '/trustPolicy/environment', 'trust policy environment is invalid')
  }
  const ids = new Set<string>()
  const fingerprints = new Set<string>()
  for (let index = 0; index < policy.keys.length; index++) {
    const key = policy.keys[index]
    const path = `/trustPolicy/keys/${index}`
    const valid = object(key)
      && exactKeys(key, [
        'keyId',
        'algorithm',
        'roles',
        'publicKeySpkiDerBase64',
        'publicKeySha256',
        'status',
        'validFrom',
        'validUntil',
      ])
      && nonEmpty(key.keyId)
      && key.algorithm === 'Ed25519'
      && Array.isArray(key.roles)
      && key.roles.length > 0
      && key.roles.every((role) => role === 'collection_owner' || role === 'statistical_reviewer')
      && nonEmpty(key.publicKeySpkiDerBase64)
      && SHA256.test(String(key.publicKeySha256 ?? ''))
      && (key.status === 'active' || key.status === 'revoked')
      && Number.isFinite(Date.parse(key.validFrom))
      && Number.isFinite(Date.parse(key.validUntil))
    if (!valid) {
      add(errors, 'SCHEMA_INVALID', path, 'trusted key schema is invalid')
      continue
    }
    if (ids.has(key.keyId) || fingerprints.has(key.publicKeySha256)) {
      add(errors, 'SCHEMA_INVALID', path, 'trusted key id and fingerprint must be unique')
    }
    ids.add(key.keyId)
    fingerprints.add(key.publicKeySha256)
  }
}

function validateTransition(
  envelope: TierBPublicEnvelope,
  parent: TierBPublicEnvelope,
  restricted: TierBRestrictedEnvelope,
  trustPolicy: TierBTrustPolicy,
  now: string,
  path: string,
  errors: TierBValidationError[],
) {
  const transition = envelope.transition
  if (!object(transition) || !object(transition.context) || !object(transition.signature)) {
    add(errors, 'SIGNATURE_INVALID', `${path}/transition`, 'signed lifecycle transition is missing')
    return
  }
  if (!exactKeys(transition, ['context', 'signature'])
    || !exactKeys(transition.context, [
      'domain',
      'packetId',
      'fromState',
      'toState',
      'repositoryCommit',
      'configurationSha256',
      'parentPublicEnvelopeSha256',
      'publicPayloadSha256',
      'restrictedEnvelopeSha256',
    ])
    || !exactKeys(transition.signature, [
      'algorithm',
      'keyId',
      'signatureBase64',
    ])) {
    add(errors, 'SCHEMA_INVALID', `${path}/transition`, 'transition has unknown or missing fields')
    return
  }
  const domain = envelope.state === 'collection_authorized'
    ? 'POSTURE-AI-TIERB-AUTHORIZATION-V1'
    : 'POSTURE-AI-TIERB-ADJUDICATION-V1'
  const expectedContext: TierBTransition['context'] = {
    domain,
    packetId: envelope.packetId,
    fromState: parent.state as TierBTransition['context']['fromState'],
    toState: envelope.state as TierBTransition['context']['toState'],
    repositoryCommit: envelope.repositoryCommit!,
    configurationSha256: envelope.configurationSha256!,
    parentPublicEnvelopeSha256: sha256TierB(parent),
    publicPayloadSha256: envelope.payloadSha256,
    restrictedEnvelopeSha256: sha256TierB(restricted),
  }
  if (!same(transition.context, expectedContext)) {
    add(errors, 'SIGNATURE_CONTEXT_MISMATCH', `${path}/transition/context`, 'signature context does not bind the exact packet transition')
    return
  }
  if (transition.signature.algorithm !== 'Ed25519' || !nonEmpty(transition.signature.keyId)) {
    add(errors, 'SIGNATURE_INVALID', `${path}/transition/signature`, 'only a named Ed25519 signer is accepted')
    return
  }
  const trusted = trustPolicy.keys.find((key) => key.keyId === transition.signature.keyId)
  if (!trusted) {
    add(errors, 'TRUST_KEY_NOT_FOUND', `${path}/transition/signature/keyId`, 'signer is absent from the independently pinned trust policy')
    return
  }
  const role = envelope.state === 'collection_authorized'
    ? 'collection_owner'
    : 'statistical_reviewer'
  if (!trusted.roles.includes(role)) {
    add(errors, 'TRUST_KEY_ROLE_MISMATCH', `${path}/transition/signature/keyId`, `signer is not trusted as ${role}`)
  }
  if (trusted.status !== 'active') {
    add(errors, 'TRUST_KEY_INACTIVE', `${path}/transition/signature/keyId`, 'signer key is not active')
  }
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)
    || nowMs < Date.parse(trusted.validFrom)
    || nowMs > Date.parse(trusted.validUntil)) {
    add(errors, 'TRUST_KEY_EXPIRED', `${path}/transition/signature/keyId`, 'signer key is outside its validity window')
  }
  let publicDer: Buffer
  let signature: Buffer
  try {
    publicDer = Buffer.from(trusted.publicKeySpkiDerBase64, 'base64')
    signature = Buffer.from(transition.signature.signatureBase64, 'base64')
    if (publicDer.toString('base64') !== trusted.publicKeySpkiDerBase64
      || signature.toString('base64') !== transition.signature.signatureBase64) {
      throw new Error('non-canonical base64')
    }
  } catch {
    add(errors, 'SIGNATURE_INVALID', `${path}/transition/signature`, 'signature or public key encoding is invalid')
    return
  }
  if (sha256TierBBytes(publicDer) !== trusted.publicKeySha256) {
    add(errors, 'TRUST_KEY_FINGERPRINT_MISMATCH', `${path}/transition/signature/keyId`, 'public key does not match its trusted fingerprint')
    return
  }
  try {
    const publicKey = createPublicKey({ key: publicDer, format: 'der', type: 'spki' })
    if (!verifySignature(null, signatureMessage(expectedContext), publicKey, signature)) {
      add(errors, 'SIGNATURE_INVALID', `${path}/transition/signature`, 'Ed25519 signature verification failed')
    }
  } catch {
    add(errors, 'SIGNATURE_INVALID', `${path}/transition/signature`, 'Ed25519 signature verification failed')
  }
}

function validateFrozenProvenance(
  value: unknown,
  envelope: TierBPublicEnvelope,
  errors: TierBValidationError[],
) {
  if (!object(value)) {
    add(errors, 'FROZEN_PROVENANCE_INCOMPLETE', '/payload/frozenProvenance', 'frozen provenance is required before collection')
    return
  }
  const build = value.captureBuild
  const engine = value.engine
  const model = value.poseModel
  const protocol = value.protocol
  const analysis = value.analysis
  const devices = value.devices
  const operators = value.operators
  const coreValid = object(build)
    && exactKeys(build, [
      'commitSha',
      'deploymentId',
      'deploymentUrl',
      'configurationSha256',
      'buildReceiptSha256',
    ])
    && COMMIT.test(String(build.commitSha ?? ''))
    && boundedPublicText(build.deploymentId, 128)
    && boundedPublicText(build.deploymentUrl, 512)
    && SHA256.test(String(build.configurationSha256 ?? ''))
    && SHA256.test(String(build.buildReceiptSha256 ?? ''))
    && build.commitSha === envelope.repositoryCommit
    && build.configurationSha256 === envelope.configurationSha256
    && object(engine)
    && exactKeys(engine, ['version', 'sourceSha256'])
    && nonEmpty(engine.version)
    && SHA256.test(String(engine.sourceSha256 ?? ''))
    && object(model)
    && exactKeys(model, ['variant', 'modelAssets', 'wasmAssets'])
    && (model.variant === 'lite' || model.variant === 'full')
    && Array.isArray(model.modelAssets)
    && model.modelAssets.length > 0
    && model.modelAssets.every((asset) =>
      exactKeys(asset, ['path', 'sha256']) && validArtifactRef(asset))
    && Array.isArray(model.wasmAssets)
    && model.wasmAssets.length > 0
    && model.wasmAssets.every((asset) =>
      exactKeys(asset, ['path', 'sha256']) && validArtifactRef(asset))
    && object(protocol)
    && exactKeys(protocol, ['version', 'documentSha256'])
    && protocol.version === TIER_B_PROTOCOL_VERSION
    && SHA256.test(String(protocol.documentSha256 ?? ''))
    && object(analysis)
    && exactKeys(analysis, ['version', 'sourceSha256'])
    && analysis.version === TIER_B_ANALYSIS_VERSION
    && SHA256.test(String(analysis.sourceSha256 ?? ''))
  if (!coreValid) {
    add(errors, 'FROZEN_PROVENANCE_INCOMPLETE', '/payload/frozenProvenance', 'build, engine, model, protocol, or analysis provenance is incomplete or stale')
  }
  if (!Array.isArray(devices)
    || devices.length !== 2
    || new Set(devices.map((device) => object(device) ? device.deviceId : null)).size !== 2
    || devices.some((device) =>
      !object(device)
      || !exactKeys(device, [
        'deviceId',
        'manufacturer',
        'marketingModel',
        'hardwareModel',
        'osName',
        'osVersion',
        'browserName',
        'browserVersion',
        'cameraFacing',
      ])
      || !['deviceId', 'manufacturer', 'marketingModel', 'hardwareModel', 'osName', 'osVersion', 'browserName', 'browserVersion', 'cameraFacing']
        .every((field) => nonEmpty(device[field]))
      || device.cameraFacing !== 'rear')) {
    add(errors, 'DEVICE_SET_INVALID', '/payload/frozenProvenance/devices', 'exactly two fully identified rear-camera devices are required')
  }
  if (!Array.isArray(operators)
    || operators.length === 0
    || new Set(operators.map((operator) => object(operator) ? operator.operatorId : null)).size !== operators.length
    || operators.some((operator) =>
      !exactKeys(operator, ['operatorId'])
      || !nonEmpty(operator.operatorId))) {
    add(errors, 'OPERATOR_SET_INVALID', '/payload/frozenProvenance/operators', 'at least one unique deidentified operator is required')
  }
}

function scheduleKey(cell: Record<string, unknown>): string {
  return `${cell.participantSlot}|${cell.deviceId}|${cell.repeatId}|${cell.view}`
}

function validateSchedule(
  schedule: unknown,
  provenance: unknown,
  errors: TierBValidationError[],
) {
  if (!object(schedule) || !object(provenance)) {
    add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule', 'collection schedule is missing')
    return
  }
  const participantSlots = schedule.participantSlots
  const deviceIds = schedule.deviceIds
  const repeatIds = schedule.repeatIds
  const views = schedule.views
  const cells = schedule.cells
  const expectedSlots = Array.from({ length: 15 }, (_, index) => index + 1)
  const expectedDevices = Array.isArray(provenance.devices)
    ? provenance.devices.map((device) => object(device) ? device.deviceId : null)
    : []
  const dimensionsValid = same(participantSlots, expectedSlots)
    && same(deviceIds, expectedDevices)
    && same(repeatIds, TIER_B_REPEAT_IDS)
    && same(views, TIER_B_VIEWS)
    && Array.isArray(cells)
    && cells.length === 15 * 2 * 3 * 4
  if (!dimensionsValid || !Array.isArray(cells)) {
    add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule', 'schedule dimensions differ from the frozen design')
    return
  }
  const observed = new Map<string, Record<string, unknown>>()
  for (const value of cells) {
    if (!object(value)
      || !Number.isInteger(value.participantSlot)
      || !expectedSlots.includes(value.participantSlot as number)
      || !expectedDevices.includes(value.deviceId)
      || !TIER_B_REPEAT_IDS.includes(value.repeatId as never)
      || !TIER_B_VIEWS.includes(value.view as never)
      || !nonEmpty(value.operatorId)
      || !Number.isInteger(value.scheduledSequence)
      || Number(value.scheduledSequence) < 1
      || Number(value.scheduledSequence) > 24) {
      add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule/cells', 'schedule cell is malformed')
      continue
    }
    const key = scheduleKey(value)
    if (observed.has(key)) {
      add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule/cells', `duplicate scheduled cell ${key}`)
    }
    observed.set(key, value)
  }
  const expected = expectedSlots.flatMap((participantSlot) =>
    expectedDevices.flatMap((deviceId) =>
      TIER_B_REPEAT_IDS.flatMap((repeatId) =>
        TIER_B_VIEWS.map((view) => `${participantSlot}|${deviceId}|${repeatId}|${view}`),
      ),
    ),
  )
  if (expected.some((key) => !observed.has(key))) {
    add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule/cells', 'schedule does not equal the exact participant/device/repeat/view product')
  }
  for (const participantSlot of expectedSlots) {
    const participantCells = cells
      .filter((cell) => object(cell) && cell.participantSlot === participantSlot)
      .sort((left, right) =>
        Number((left as Record<string, unknown>).scheduledSequence)
        - Number((right as Record<string, unknown>).scheduledSequence))
    const sequences = participantCells
      .map((cell) => Number((cell as Record<string, unknown>).scheduledSequence))
    if (!same(sequences, Array.from({ length: 24 }, (_, index) => index + 1))) {
      add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule/cells', `participant slot ${participantSlot} does not have one exact 1..24 schedule`)
      continue
    }
    const deviceOrder = participantSlot % 2 === 1
      ? expectedDevices
      : [...expectedDevices].reverse()
    const rotation = (participantSlot - 1) % TIER_B_VIEWS.length
    const viewOrder = [
      ...TIER_B_VIEWS.slice(rotation),
      ...TIER_B_VIEWS.slice(0, rotation),
    ]
    const expectedParticipantKeys = deviceOrder.flatMap((deviceId) =>
      TIER_B_REPEAT_IDS.flatMap((repeatId) =>
        viewOrder.map((view) => `${participantSlot}|${deviceId}|${repeatId}|${view}`)))
    if (!same(participantCells.map(scheduleKey), expectedParticipantKeys)) {
      add(
        errors,
        'SCHEDULE_INVALID',
        '/restrictedEnvelope/payload/schedule/cells',
        `participant slot ${participantSlot} violates the frozen device/view counterbalance`,
      )
    }
  }
}

function validateAuthorizedPayload(
  payload: unknown,
  envelope: TierBPublicEnvelope,
  restricted: TierBRestrictedEnvelope,
  errors: TierBValidationError[],
) {
  if (!object(payload)
    || !exactKeys(payload, [
      'protocolVersion',
      'analysisVersion',
      'collectionAuthorized',
      'consumerEligible',
      'frozenProvenance',
      'analysis',
      'profile',
      'adjudication',
    ])
    || payload.protocolVersion !== TIER_B_PROTOCOL_VERSION
    || payload.analysisVersion !== TIER_B_ANALYSIS_VERSION) {
    add(errors, 'SCHEMA_INVALID', '/payload', 'authorized payload schema is invalid')
    return
  }
  if (payload.collectionAuthorized !== true) {
    add(errors, 'PREPARED_AUTHORIZATION_FORBIDDEN', '/payload/collectionAuthorized', 'authorized state must explicitly authorize collection')
  }
  if (payload.consumerEligible !== false) {
    add(errors, 'PREPARED_ELIGIBILITY_FORBIDDEN', '/payload/consumerEligible', 'collection authorization cannot establish consumer eligibility')
  }
  if (payload.analysis !== null || payload.profile !== null || payload.adjudication !== null) {
    add(errors, 'SCHEMA_INVALID', '/payload', 'collection authorization cannot contain analysis or adjudication')
  }
  validateFrozenProvenance(payload.frozenProvenance, envelope, errors)
  if (!object(restricted.payload)
    || !exactKeys(restricted.payload, ['schedule', 'manifest'])
    || restricted.payload.manifest !== null) {
    add(errors, 'SCHEMA_INVALID', '/restrictedEnvelope/payload', 'authorized restricted envelope must contain a schedule and null manifest')
  } else {
    validateSchedule(restricted.payload.schedule, payload.frozenProvenance, errors)
  }
}

function artifactExpectation(value: unknown): TierBArtifactExpectation | null {
  if (!object(value)
    || !safeRelativeArtifactPath(String(value.path ?? ''))
    || !SHA256.test(String(value.sha256 ?? ''))
    || !Number.isInteger(value.byteLength)
    || Number(value.byteLength) < 0
    || !['image/jpeg', 'image/png', 'application/json'].includes(String(value.mime ?? ''))) {
    return null
  }
  return {
    path: String(value.path),
    sha256: value.sha256 as TierBSha256,
    byteLength: Number(value.byteLength),
    mime: value.mime as TierBArtifactMime,
  }
}

function verifyArtifact(
  value: unknown,
  path: string,
  reader: TierBArtifactReader | undefined,
  errors: TierBValidationError[],
): TierBVerifiedArtifact | null {
  const expected = artifactExpectation(value)
  if (!expected) {
    add(errors, 'SCHEMA_INVALID', path, 'artifact manifest reference is invalid')
    return null
  }
  if (!reader) {
    add(errors, 'ARTIFACT_READER_REQUIRED', path, 'adjudication requires a descriptor-safe artifact reader')
    return null
  }
  try {
    const artifact = reader.readVerified(expected)
    if (artifact.sha256 !== expected.sha256
      || artifact.byteLength !== expected.byteLength
      || artifact.mime !== expected.mime
      || sha256TierBBytes(artifact.bytes) !== expected.sha256) {
      add(errors, 'ARTIFACT_HASH_MISMATCH', path, 'verified artifact bytes differ from the manifest')
      return null
    }
    return artifact
  } catch (error) {
    if (error instanceof TierBArtifactVerificationError) {
      add(errors, error.code, path, error.message)
    } else {
      add(errors, 'ARTIFACT_HASH_MISMATCH', path, 'artifact could not be read and verified')
    }
    return null
  }
}

function validateLandmarkBinding(
  bytes: Uint8Array,
  row: Record<string, unknown>,
  frozenProvenance: unknown,
  path: string,
  errors: TierBValidationError[],
): { frames: PoseFrame[]; result: ReturnType<typeof assessPosture> } | null {
  let landmark: unknown
  try {
    landmark = parseCanonicalTierBJson(Buffer.from(bytes).toString('utf8'))
  } catch {
    add(errors, 'ARTIFACT_CANONICAL_BYTES_MISMATCH', path, 'landmark JSON is not strict canonical JSON')
    return null
  }
  if (!object(landmark)) {
    add(errors, 'SCHEMA_INVALID', path, 'landmark artifact must be an object')
    return null
  }
  const sourcePhoto = object(row.sourcePhoto) ? row.sourcePhoto : {}
  const landmarks = object(row.landmarks) ? row.landmarks : {}
  const captureSlot = TIER_B_CAPTURE_SLOTS.find((slot) => slot.key === row.view)
  const expectedView = captureSlot?.engineView
  const expectedProfile = captureSlot?.profileSide
  const frozen = object(frozenProvenance) ? frozenProvenance : {}
  const frozenEngine = object(frozen.engine) ? frozen.engine : {}
  const frozenModel = object(frozen.poseModel) ? frozen.poseModel : {}
  if (landmark.rowBindingSha256 !== row.rowBindingSha256
    || landmark.sourcePhotoSha256 !== sourcePhoto.sha256
    || landmark.protocolVersion !== TIER_B_PROTOCOL_VERSION
    || landmark.analysisVersion !== TIER_B_ANALYSIS_VERSION
    || landmark.engineVersion !== frozenEngine.version
    || landmark.engineVersion !== ENGINE_VERSION
    || landmark.poseModel !== frozenModel.variant
    || landmark.view !== expectedView
    || landmark.profileSide !== expectedProfile
    || !Array.isArray(landmark.frames)
    || landmark.frames.length !== landmarks.frameCount) {
    add(errors, 'VIEW_PROFILE_MISMATCH', path, 'landmark metadata or view/profile binding differs from the manifest row')
    return null
  }
  const frames = landmark.frames
  if (
    frames.length === 0
    || frames.length > TIER_B_MAX_FRAMES_PER_ARTIFACT
  ) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      path,
      `landmark artifact must contain one to ${TIER_B_MAX_FRAMES_PER_ARTIFACT} frozen-engine frames`,
    )
    return null
  }
  if (frames.some((frame) =>
    !object(frame)
    || frame.view !== expectedView
    || (frame.profileSide ?? null) !== expectedProfile)) {
    add(
      errors,
      'VIEW_PROFILE_MISMATCH',
      path,
      'one or more landmark frames differ from the manifest row view/profile binding',
    )
    return null
  }
  try {
    const poseFrames = frames as PoseFrame[]
    const result = assessPosture(poseFrames)
    if (result.engineVersion !== ENGINE_VERSION) throw new Error('engine version mismatch')
    return { frames: poseFrames, result }
  } catch {
    add(errors, 'ANALYSIS_CONTRACT_INVALID', path, 'verified landmark frames cannot be scored by the frozen engine')
    return null
  }
}

interface TierBDerivedMeasurement {
  reliable: boolean
  value: number | null
}

function derivedMeasurementKey(
  participantId: unknown,
  deviceId: unknown,
  repeatId: unknown,
  view: unknown,
  metricId: unknown,
): string {
  return [participantId, deviceId, repeatId, view, metricId].join('|')
}

function validateManifest(
  manifest: unknown,
  schedule: unknown,
  authorizedEnvelope: TierBPublicEnvelope,
  authorizedPayload: Record<string, unknown>,
  reader: TierBArtifactReader | undefined,
  errors: TierBValidationError[],
): {
  manifestSha256: TierBSha256
  datasetFingerprint: TierBSha256
  derivedMeasurements: Map<string, TierBDerivedMeasurement>
} | null {
  const path = '/restrictedEnvelope/payload/manifest'
  if (!object(manifest)
    || manifest.schemaVersion !== 'tierb-collection-manifest-v1'
    || !Array.isArray(manifest.activatedParticipantSlots)
    || !Array.isArray(manifest.rows)) {
    add(errors, 'SCHEMA_INVALID', path, 'collection manifest schema is invalid')
    return null
  }
  const authorizationPublicEnvelopeSha256 = sha256TierB(authorizedEnvelope)
  const frozenProvenance = authorizedPayload.frozenProvenance
  const frozenProvenanceSha256 = sha256TierB(frozenProvenance)
  if (manifest.authorizationPublicEnvelopeSha256 !== authorizationPublicEnvelopeSha256
    || manifest.frozenProvenanceSha256 !== frozenProvenanceSha256) {
    add(errors, 'HASH_MISMATCH', path, 'manifest is not bound to the authorized envelope and frozen provenance')
  }
  const slots = manifest.activatedParticipantSlots
  const slotsValid = slots.length >= 12
    && slots.length <= 15
    && slots.every((slot) => Number.isInteger(slot) && Number(slot) >= 1 && Number(slot) <= 15)
    && new Set(slots).size === slots.length
    && same(slots, [...slots].sort((left, right) => Number(left) - Number(right)))
  if (!slotsValid) {
    add(errors, 'MANIFEST_CELL_SET_MISMATCH', `${path}/activatedParticipantSlots`, 'activated slots must be 12 to 15 sorted unique slots from the authorized schedule')
  }

  const scheduleCells = object(schedule) && Array.isArray(schedule.cells)
    ? schedule.cells.filter(object)
    : []
  const scheduleByKey = new Map(scheduleCells.map((cell) => [scheduleKey(cell), cell]))
  // Build the exact product from the authorized schedule, not from row-supplied dimensions.
  const requiredKeys = slotsValid
    ? scheduleCells
        .filter((cell) => slots.includes(cell.participantSlot))
        .map(scheduleKey)
        .sort()
    : []
  const rows = manifest.rows
  const observedKeys: string[] = []
  const rowIds = new Set<string>()
  const photoHashes = new Set<string>()
  const datasetArtifacts: Array<Record<string, unknown>> = []
  const derivedMeasurements = new Map<string, TierBDerivedMeasurement>()
  const slotToCluster = new Map<number, string>()
  const clusterToSlot = new Map<string, number>()
  const slotToConsentReceipt = new Map<number, string>()
  const consentReceiptToSlot = new Map<string, number>()
  let priorRowId: string | null = null

  rows.forEach((value, index) => {
    const rowPath = `${path}/rows/${index}`
    if (!object(value)) {
      add(errors, 'SCHEMA_INVALID', rowPath, 'manifest row must be an object')
      return
    }
    const row = value
    if (!nonEmpty(row.rowId)
      || !Number.isInteger(row.participantSlot)
      || !CLUSTER_ID.test(String(row.clusterId ?? ''))
      || !nonEmpty(row.deviceId)
      || !nonEmpty(row.operatorId)
      || !TIER_B_REPEAT_IDS.includes(row.repeatId as never)
      || !TIER_B_VIEWS.includes(row.view as never)
      || !Number.isInteger(row.scheduledSequence)
      || !Number.isFinite(Date.parse(String(row.capturedAt ?? '')))
      || !object(row.consent)
      || row.consent.verified !== true
      || row.consent.deidentified !== true
      || row.consent.withdrawalState !== 'active'
      || !nonEmpty(row.consent.receiptId)
      || !object(row.sourcePhoto)
      || !object(row.landmarks)
      || row.authorizationPublicEnvelopeSha256 !== authorizationPublicEnvelopeSha256
      || row.frozenProvenanceSha256 !== frozenProvenanceSha256
      || !SHA256.test(String(row.rowBindingSha256 ?? ''))) {
      add(errors, 'SCHEMA_INVALID', rowPath, 'manifest row schema or authorization binding is invalid')
    }
    const participantSlot = Number(row.participantSlot)
    const clusterId = String(row.clusterId ?? '')
    const consentReceiptId = object(row.consent)
      ? String(row.consent.receiptId ?? '')
      : ''
    const priorCluster = slotToCluster.get(participantSlot)
    const priorClusterSlot = clusterToSlot.get(clusterId)
    const priorConsent = slotToConsentReceipt.get(participantSlot)
    const priorConsentSlot = consentReceiptToSlot.get(consentReceiptId)
    if ((priorCluster !== undefined && priorCluster !== clusterId)
      || (priorClusterSlot !== undefined && priorClusterSlot !== participantSlot)
      || (priorConsent !== undefined && priorConsent !== consentReceiptId)
      || (priorConsentSlot !== undefined && priorConsentSlot !== participantSlot)) {
      add(
        errors,
        'MANIFEST_DUPLICATE_ROW',
        rowPath,
        'participant slot, cluster id, and consent receipt must have one stable one-to-one mapping',
      )
    } else {
      slotToCluster.set(participantSlot, clusterId)
      clusterToSlot.set(clusterId, participantSlot)
      slotToConsentReceipt.set(participantSlot, consentReceiptId)
      consentReceiptToSlot.set(consentReceiptId, participantSlot)
    }
    const rowId = String(row.rowId ?? '')
    if (rowIds.has(rowId)) add(errors, 'MANIFEST_DUPLICATE_ROW', `${rowPath}/rowId`, `duplicate row id ${rowId}`)
    rowIds.add(rowId)
    if (priorRowId !== null && priorRowId.localeCompare(rowId) >= 0) {
      add(errors, 'MANIFEST_DUPLICATE_ROW', `${rowPath}/rowId`, 'manifest rows must be strictly sorted by row id')
    }
    priorRowId = rowId

    const key = scheduleKey(row)
    observedKeys.push(key)
    const scheduled = scheduleByKey.get(key)
    if (!scheduled
      || scheduled.operatorId !== row.operatorId
      || scheduled.scheduledSequence !== row.scheduledSequence) {
      add(errors, 'MANIFEST_SCHEDULE_MISMATCH', rowPath, 'manifest row does not match its authorized schedule cell')
    }
    const sourcePhoto = object(row.sourcePhoto) ? row.sourcePhoto : {}
    const landmarks = object(row.landmarks) ? row.landmarks : {}
    if (sourcePhoto.mime !== 'image/jpeg' && sourcePhoto.mime !== 'image/png') {
      add(
        errors,
        'ARTIFACT_MIME_MISMATCH',
        `${rowPath}/sourcePhoto/mime`,
        'source photo must be JPEG or PNG',
      )
    }
    if (landmarks.mime !== 'application/json') {
      add(
        errors,
        'ARTIFACT_MIME_MISMATCH',
        `${rowPath}/landmarks/mime`,
        'landmark artifact must be canonical JSON',
      )
    }
    const photoHash = String(sourcePhoto.sha256 ?? '')
    if (photoHashes.has(photoHash)) {
      add(errors, 'MANIFEST_DUPLICATE_PHOTO', `${rowPath}/sourcePhoto/sha256`, 'one source photo cannot represent two physical observations')
    }
    photoHashes.add(photoHash)
    const expectedBinding = sha256TierB({
      authorizationPublicEnvelopeSha256,
      frozenProvenanceSha256,
      participantSlot: row.participantSlot,
      clusterId: row.clusterId,
      deviceId: row.deviceId,
      operatorId: row.operatorId,
      repeatId: row.repeatId,
      view: row.view,
      scheduledSequence: row.scheduledSequence,
      capturedAt: row.capturedAt,
      sourcePhotoSha256: sourcePhoto.sha256,
    })
    if (row.rowBindingSha256 !== expectedBinding) {
      add(errors, 'ROW_BINDING_MISMATCH', `${rowPath}/rowBindingSha256`, 'row binding hash does not cover the exact observation')
    }
    verifyArtifact(row.sourcePhoto, `${rowPath}/sourcePhoto`, reader, errors)
    const landmarkArtifact = verifyArtifact(row.landmarks, `${rowPath}/landmarks`, reader, errors)
    const scoredArtifact = landmarkArtifact
      ? validateLandmarkBinding(
          landmarkArtifact.bytes,
          row,
          frozenProvenance,
          `${rowPath}/landmarks`,
          errors,
        )
      : null
    if (scoredArtifact) {
      const requiredMetrics = TIER_B_METRIC_REGISTRY.filter((metric) =>
        metric.status === 'candidate'
        && metric.requiredViews.includes(row.view as never))
      for (const metric of requiredMetrics) {
        const finding = scoredArtifact.result.findings.find(
          (candidate) => candidate.key === metric.key,
        )
        if (!finding) {
          add(
            errors,
            'ANALYSIS_CONTRACT_INVALID',
            rowPath,
            `frozen engine omitted required metric ${metric.key}`,
          )
          continue
        }
        const measurementKey = derivedMeasurementKey(
          row.clusterId,
          row.deviceId,
          row.repeatId,
          row.view,
          metric.key,
        )
        if (derivedMeasurements.has(measurementKey)) {
          add(errors, 'ANALYSIS_CONTRACT_INVALID', rowPath, `duplicate derived measurement ${measurementKey}`)
          continue
        }
        derivedMeasurements.set(measurementKey, {
          reliable: finding.reliable,
          value: finding.reliable ? finding.severityPct : null,
        })
      }
    }
    datasetArtifacts.push({
      rowId,
      rowBindingSha256: row.rowBindingSha256,
      sourcePhotoSha256: sourcePhoto.sha256,
      landmarksSha256: landmarks.sha256,
    })
  })

  if (slotToCluster.size !== slots.length
    || clusterToSlot.size !== slots.length
    || slotToConsentReceipt.size !== slots.length
    || consentReceiptToSlot.size !== slots.length) {
    add(
      errors,
      'MANIFEST_DUPLICATE_ROW',
      `${path}/rows`,
      'activated participants must have exactly one cluster id and one unique consent receipt each',
    )
  }
  if (!same([...observedKeys].sort(), requiredKeys)
    || new Set(observedKeys).size !== observedKeys.length) {
    add(errors, 'MANIFEST_CELL_SET_MISMATCH', `${path}/rows`, 'manifest must equal the exact activated participant/device/repeat/view product')
  }
  const manifestSha256 = sha256TierB(manifest)
  return {
    manifestSha256,
    datasetFingerprint: sha256TierB({
      authorizationPublicEnvelopeSha256,
      manifestSha256,
      artifacts: datasetArtifacts,
    }),
    derivedMeasurements,
  }
}

interface TierBMetricEligibility {
  analysisEligible: boolean
  consumerMdc95PercentagePoints: number | null
}

function primaryAnalysisKey(
  deviceId: unknown,
  metricId: unknown,
  view: unknown,
): string {
  return `${String(deviceId)}|${String(metricId)}|${String(view)}`
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-10 * Math.max(1, Math.abs(right))
}

function validInterval(value: unknown): boolean {
  return object(value)
    && exactKeys(value, [
      'lower',
      'median',
      'upper',
      'confidenceLevel',
      'percentileMethod',
    ])
    && finiteNumber(value.lower)
    && finiteNumber(value.median)
    && finiteNumber(value.upper)
    && value.lower <= value.median
    && value.median <= value.upper
    && value.confidenceLevel === 0.95
    && value.percentileMethod === 'type-7'
}

const PRIMARY_FAILURE_REASONS = new Set([
  'fewer-than-12-complete-participants',
  'metric-cell-missingness-over-20-percent',
  'bootstrap-fewer-than-9500-valid-attempts',
  'undefined-reliability-statistics',
])
const BOOTSTRAP_INVALID_REASONS = new Set([
  'undefined-reliability-statistics',
])

function validateAnalysisAndDeriveEligibility(
  analysis: unknown,
  deviceIds: string[],
  participantCount: number,
  errors: TierBValidationError[],
): Map<string, TierBMetricEligibility> {
  const derived = new Map<string, TierBMetricEligibility>()
  const candidateMetrics = TIER_B_METRIC_REGISTRY.filter(
    (metric) => metric.status === 'candidate',
  )
  const expectedCells = candidateMetrics.flatMap((metric) =>
    metric.requiredViews.map((view) => ({ metricId: metric.key, view })))
  const expectedPrimaryKeys = deviceIds.flatMap((deviceId) =>
    expectedCells.map((cell) =>
      primaryAnalysisKey(deviceId, cell.metricId, cell.view)))
  const analysisRecord = object(analysis) ? analysis : {}
  const primary = Array.isArray(analysisRecord.primary)
    ? analysisRecord.primary
    : []
  const pooled = object(analysisRecord.pooledDescriptive)
    ? analysisRecord.pooledDescriptive
    : {}
  const pooledGroups = Array.isArray(pooled.groups) ? pooled.groups : []

  if (!object(analysis)
    || !exactKeys(analysis, [
      'schemaVersion',
      'analysisVersion',
      'primaryUnit',
      'consumerEligible',
      'protocol',
      'primary',
      'pooledDescriptive',
    ])
    || analysis.schemaVersion !== 'tierb-analysis-v1'
    || analysis.analysisVersion !== TIER_B_ANALYSIS_VERSION
    || analysis.primaryUnit !== 'percentage_points'
    || analysis.consumerEligible !== false
    || !object(analysis.protocol)
    || !exactKeys(analysis.protocol, [
      'pose',
      'repeatIds',
      'primaryGrouping',
      'independentCluster',
    ])
    || analysis.protocol.pose !== 'neutral'
    || !same(analysis.protocol.repeatIds, TIER_B_REPEAT_IDS)
    || analysis.protocol.primaryGrouping !== 'exact-device'
    || analysis.protocol.independentCluster !== 'participant'
    || pooled.primary !== false
    || pooled.consumerEligible !== false
    || !exactKeys(pooled, ['primary', 'consumerEligible', 'groups'])) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      '/payload/analysis',
      'analysis header differs from the frozen analyzer output contract',
    )
  }

  const observedPrimaryKeys = new Set<string>()
  const eligibleMdcByMetric = new Map<string, number[]>()
  primary.forEach((value, index) => {
    const path = `/payload/analysis/primary/${index}`
    if (!object(value)) {
      add(errors, 'ANALYSIS_CONTRACT_INVALID', path, 'primary analysis entry must be an object')
      return
    }
    if (!exactKeys(value, [
      'scope',
      'deviceId',
      'metricId',
      'view',
      'expectedParticipants',
      'completeParticipants',
      'observedMetricCells',
      'expectedMetricCells',
      'missingMetricCells',
      'absentMetricCells',
      'unreliableMetricCells',
      'missingness',
      'isEligible',
      'failureReasons',
      'stats',
      'bootstrap',
    ])) {
      add(errors, 'ANALYSIS_CONTRACT_INVALID', path, 'primary analysis entry has unknown or missing fields')
    }
    const key = primaryAnalysisKey(value.deviceId, value.metricId, value.view)
    if (observedPrimaryKeys.has(key)) {
      add(errors, 'ANALYSIS_CONTRACT_INVALID', path, `duplicate primary analysis cell ${key}`)
    }
    observedPrimaryKeys.add(key)

    const failureReasons = Array.isArray(value.failureReasons)
      ? value.failureReasons
      : []
    const validFailureReasons = failureReasons.every((reason) =>
      typeof reason === 'string' && PRIMARY_FAILURE_REASONS.has(reason))
      && new Set(failureReasons).size === failureReasons.length
    const expectedMetricCells = participantCount * TIER_B_REPEAT_IDS.length
    const countsValid = value.scope === 'primary-exact-device'
      && deviceIds.includes(String(value.deviceId))
      && expectedCells.some((cell) =>
        cell.metricId === value.metricId && cell.view === value.view)
      && value.expectedParticipants === participantCount
      && Number.isInteger(value.completeParticipants)
      && Number(value.completeParticipants) >= 0
      && Number(value.completeParticipants) <= participantCount
      && value.expectedMetricCells === expectedMetricCells
      && Number.isInteger(value.observedMetricCells)
      && Number.isInteger(value.missingMetricCells)
      && Number.isInteger(value.absentMetricCells)
      && Number.isInteger(value.unreliableMetricCells)
      && Number(value.observedMetricCells) + Number(value.missingMetricCells)
        === expectedMetricCells
      && Number(value.absentMetricCells) + Number(value.unreliableMetricCells)
        === Number(value.missingMetricCells)
      && finiteNumber(value.missingness)
      && Math.abs(
        value.missingness - Number(value.missingMetricCells) / expectedMetricCells,
      ) <= 1e-12
      && Array.isArray(value.failureReasons)
      && validFailureReasons

    const stats = object(value.stats) ? value.stats : null
    const meanSquares = stats && object(stats.meanSquares)
      ? stats.meanSquares
      : null
    const varianceComponents = stats && object(stats.varianceComponents)
      ? stats.varianceComponents
      : null
    const nonnegativeComponents = stats && object(stats.nonnegativeVarianceComponents)
      ? stats.nonnegativeVarianceComponents
      : null
    const nCases = Number(value.completeParticipants)
    const kRepeats = TIER_B_REPEAT_IDS.length
    const msCases = meanSquares && finiteNumber(meanSquares.cases)
      ? meanSquares.cases
      : Number.NaN
    const msOccasions = meanSquares && finiteNumber(meanSquares.occasions)
      ? meanSquares.occasions
      : Number.NaN
    const mse = meanSquares && finiteNumber(meanSquares.error)
      ? meanSquares.error
      : Number.NaN
    const caseVariance = (msCases - mse) / kRepeats
    const occasionVariance = (msOccasions - mse) / nCases
    const iccDenominator = msCases
      + (kRepeats - 1) * mse
      + (kRepeats / nCases) * (msOccasions - mse)
    const expectedIcc = (msCases - mse) / iccDenominator
    const expectedSemConsistency = Math.sqrt(mse)
    const expectedSemAgreement = Math.sqrt(mse + Math.max(0, occasionVariance))
    const expectedMdc = 1.96 * Math.SQRT2 * expectedSemAgreement
    const statsValid = stats !== null
      && exactKeys(stats, [
        'nCases',
        'kRepeats',
        'icc21',
        'meanSquares',
        'varianceComponents',
        'nonnegativeVarianceComponents',
        'semConsistency',
        'semAgreement',
        'sem',
        'mdc95',
        'mean',
        'sd',
      ])
      && exactKeys(stats.meanSquares, ['cases', 'occasions', 'error'])
      && exactKeys(stats.varianceComponents, ['cases', 'occasions', 'error'])
      && exactKeys(stats.nonnegativeVarianceComponents, ['cases', 'occasions', 'error'])
      && stats.nCases === nCases
      && stats.kRepeats === kRepeats
      && finiteNumber(stats.icc21)
      && finiteNumber(stats.semConsistency)
      && finiteNumber(stats.semAgreement)
      && finiteNumber(stats.mdc95)
      && finiteNumber(stats.sem)
      && finiteNumber(stats.mean)
      && finiteNumber(stats.sd)
      && stats.sd >= 0
      && mse >= 0
      && finiteNumber(expectedIcc)
      && approximatelyEqual(stats.icc21, expectedIcc)
      && approximatelyEqual(stats.semConsistency, expectedSemConsistency)
      && approximatelyEqual(stats.semAgreement, expectedSemAgreement)
      && approximatelyEqual(stats.sem, expectedSemAgreement)
      && approximatelyEqual(stats.mdc95, expectedMdc)
      && stats.semConsistency >= 0
      && stats.semAgreement >= stats.semConsistency
      && varianceComponents !== null
      && finiteNumber(varianceComponents.cases)
      && finiteNumber(varianceComponents.occasions)
      && finiteNumber(varianceComponents.error)
      && approximatelyEqual(varianceComponents.cases, caseVariance)
      && approximatelyEqual(varianceComponents.occasions, occasionVariance)
      && approximatelyEqual(varianceComponents.error, mse)
      && nonnegativeComponents !== null
      && finiteNumber(nonnegativeComponents.cases)
      && finiteNumber(nonnegativeComponents.occasions)
      && finiteNumber(nonnegativeComponents.error)
      && approximatelyEqual(nonnegativeComponents.cases, Math.max(0, caseVariance))
      && approximatelyEqual(nonnegativeComponents.occasions, Math.max(0, occasionVariance))
      && approximatelyEqual(nonnegativeComponents.error, Math.max(0, mse))

    const bootstrap = object(value.bootstrap) ? value.bootstrap : null
    const invalidReasonCounts = bootstrap && object(bootstrap.invalidReasonCounts)
      ? bootstrap.invalidReasonCounts
      : null
    const validInvalidReasonCounts = invalidReasonCounts !== null
      && Object.keys(invalidReasonCounts).every((reason) =>
        BOOTSTRAP_INVALID_REASONS.has(reason))
      && Object.values(invalidReasonCounts).every((count) =>
        Number.isInteger(count) && Number(count) >= 0)
      && Object.values(invalidReasonCounts)
        .reduce<number>((sum, count) => sum + Number(count), 0)
        === Number(bootstrap?.invalidAttempts)
    const bootstrapValid = bootstrap !== null
      && exactKeys(bootstrap, [
        'method',
        'seed',
        'requestedAttempts',
        'validAttempts',
        'invalidAttempts',
        'minimumValidAttempts',
        'hasSufficientValidAttempts',
        'invalidReasonCounts',
        'intervals',
      ])
      && bootstrap.method === 'participant-cluster-sha256-counter'
      && boundedPublicText(bootstrap.seed, 512)
      && bootstrap.requestedAttempts === 10_000
      && Number.isInteger(bootstrap.validAttempts)
      && Number.isInteger(bootstrap.invalidAttempts)
      && Number(bootstrap.validAttempts) + Number(bootstrap.invalidAttempts) === 10_000
      && Number(bootstrap.validAttempts) >= 9_500
      && bootstrap.minimumValidAttempts === 9_500
      && bootstrap.hasSufficientValidAttempts === true
      && validInvalidReasonCounts
      && object(bootstrap.intervals)
      && exactKeys(bootstrap.intervals, ['icc21', 'semAgreement', 'mdc95'])
      && validInterval(bootstrap.intervals.icc21)
      && validInterval(bootstrap.intervals.semAgreement)
      && validInterval(bootstrap.intervals.mdc95)

    const gatesPass = countsValid
      && Number(value.completeParticipants) >= 12
      && Number(value.missingness) <= 0.2
      && statsValid
      && bootstrapValid
    const eligibilityConsistent = value.isEligible === gatesPass
      && (gatesPass
        ? failureReasons.length === 0
        : failureReasons.length > 0)
    if (!countsValid || !eligibilityConsistent) {
      add(
        errors,
        'ANALYSIS_CONTRACT_INVALID',
        path,
        'primary analysis counts, missingness, or eligibility gates are inconsistent',
      )
    }
    if (gatesPass) {
      const metricMdc = eligibleMdcByMetric.get(String(value.metricId)) ?? []
      metricMdc.push(
        ((bootstrap as Record<string, unknown>).intervals as Record<string, Record<string, number>>)
          .mdc95.upper,
      )
      eligibleMdcByMetric.set(String(value.metricId), metricMdc)
    }
  })

  if (!same([...observedPrimaryKeys].sort(), [...expectedPrimaryKeys].sort())) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      '/payload/analysis/primary',
      'primary analysis must equal the exact device/metric/view product',
    )
  }

  const pooledKeys = pooledGroups
    .filter(object)
    .map((entry) => `${String(entry.metricId)}|${String(entry.view)}`)
  const expectedPooledKeys = expectedCells.map((cell) => `${cell.metricId}|${cell.view}`)
  if (!same([...pooledKeys].sort(), [...expectedPooledKeys].sort())
    || pooledGroups.some((entry) =>
      !object(entry)
      || !exactKeys(entry, [
        'scope',
        'metricId',
        'view',
        'deviceIds',
        'participantCount',
        'measurementCount',
        'mean',
        'sampleSd',
      ])
      || entry.scope !== 'pooled-descriptive-only'
      || !same(entry.deviceIds, deviceIds)
      || 'stats' in entry
      || 'icc21' in entry
      || 'mdc95' in entry)) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      '/payload/analysis/pooledDescriptive',
      'pooled output must be complete, descriptive-only, and contain no reliability estimate',
    )
  }

  for (const metric of TIER_B_METRIC_REGISTRY) {
    if (metric.status === 'excluded_design') {
      derived.set(metric.key, {
        analysisEligible: false,
        consumerMdc95PercentagePoints: null,
      })
      continue
    }
    const requiredCount = metric.requiredViews.length * deviceIds.length
    const values = eligibleMdcByMetric.get(metric.key) ?? []
    derived.set(metric.key, {
      analysisEligible: values.length === requiredCount,
      consumerMdc95PercentagePoints: values.length === requiredCount
        ? Math.max(...values)
        : null,
    })
  }
  return derived
}

function validateAnalysisInputAndRecompute(
  value: unknown,
  analysis: unknown,
  authorizedEnvelope: TierBPublicEnvelope,
  manifest: Record<string, unknown>,
  deviceIds: string[],
  derivedMeasurements: Map<string, TierBDerivedMeasurement>,
  errors: TierBValidationError[],
) {
  const path = '/restrictedEnvelope/payload/analysisInput'
  if (!object(value)
    || !exactKeys(value, [
      'schemaVersion',
      'protocolVersion',
      'analysisVersion',
      'authorizationPublicEnvelopeSha256',
      'repositoryCommit',
      'configurationSha256',
      'unit',
      'sourceField',
      'input',
      'inputSha256',
    ])
    || value.schemaVersion !== 'tierb-analysis-input-v1'
    || value.protocolVersion !== TIER_B_PROTOCOL_VERSION
    || value.analysisVersion !== TIER_B_ANALYSIS_VERSION
    || value.authorizationPublicEnvelopeSha256 !== sha256TierB(authorizedEnvelope)
    || value.repositoryCommit !== authorizedEnvelope.repositoryCommit
    || value.configurationSha256 !== authorizedEnvelope.configurationSha256
    || value.unit !== 'percentage_points'
    || value.sourceField !== 'severityPct'
    || value.inputSha256 !== sha256TierB(value.input)) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      path,
      'restricted analysis input is not bound to the exact collection authorization',
    )
    return
  }

  const rows = Array.isArray(manifest.rows) ? manifest.rows.filter(object) : []
  const input = object(value.input) ? value.input : {}
  const participantIds = Array.isArray(input.participantIds)
    ? input.participantIds.filter((entry): entry is string => typeof entry === 'string')
    : []
  const manifestParticipants = [...new Set(rows.map((row) => String(row.clusterId ?? '')))]
    .filter(Boolean)
    .sort()
  const manifestCells = new Set(rows.map((row) => [
    row.clusterId,
    row.deviceId,
    row.repeatId,
    row.view,
  ].join('|')))
  const records = Array.isArray(input.records) ? input.records : []
  const submittedMeasurementKeys = new Set<string>()
  let recordsBoundToManifest = true
  let recordsMatchFrozenEngine = true
  for (const record of records) {
    if (!object(record)) {
      recordsBoundToManifest = false
      recordsMatchFrozenEngine = false
      continue
    }
    if (!manifestCells.has([
      record.participantId,
      record.deviceId,
      record.repeatId,
      record.view,
    ].join('|'))) {
      recordsBoundToManifest = false
    }
    const measurementKey = derivedMeasurementKey(
      record.participantId,
      record.deviceId,
      record.repeatId,
      record.view,
      record.metricId,
    )
    if (submittedMeasurementKeys.has(measurementKey)) {
      recordsMatchFrozenEngine = false
      continue
    }
    submittedMeasurementKeys.add(measurementKey)
    const derived = derivedMeasurements.get(measurementKey)
    if (derived === undefined
      || record.reliable !== derived.reliable
      || record.value !== derived.value) {
      recordsMatchFrozenEngine = false
    }
  }
  const recordsExactlyCoverFrozenEngine =
    submittedMeasurementKeys.size === derivedMeasurements.size
    && [...derivedMeasurements.keys()].every((key) =>
      submittedMeasurementKeys.has(key))
  if (!same([...participantIds].sort(), manifestParticipants)
    || !same(input.deviceIds, deviceIds)
    || !recordsBoundToManifest
    || !recordsMatchFrozenEngine
    || !recordsExactlyCoverFrozenEngine) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      path,
      'analysis participants, devices, observations, or values differ from the verified frozen-engine artifacts',
    )
    return
  }

  try {
    const recomputed = analyzeTierBReliability(value.input as TierBAnalysisInput)
    if (sha256TierB(recomputed) !== sha256TierB(analysis)) {
      add(
        errors,
        'ANALYSIS_CONTRACT_INVALID',
        '/payload/analysis',
        'public analysis differs from deterministic recomputation of the signed restricted input',
      )
    }
  } catch (error) {
    add(
      errors,
      'ANALYSIS_CONTRACT_INVALID',
      path,
      error instanceof Error ? error.message : 'analysis input could not be recomputed',
    )
  }
}

function validateAdjudicatedPayload(
  payload: unknown,
  envelope: TierBPublicEnvelope,
  restricted: TierBRestrictedEnvelope,
  authorizedEnvelope: TierBPublicEnvelope,
  authorizedRestricted: TierBRestrictedEnvelope | undefined,
  reader: TierBArtifactReader | undefined,
  errors: TierBValidationError[],
) {
  const initialErrorCount = errors.length
  if (!object(payload)
    || !exactKeys(payload, [
      'protocolVersion',
      'analysisVersion',
      'collectionAuthorized',
      'consumerEligible',
      'frozenProvenanceSha256',
      'manifestSha256',
      'datasetFingerprint',
      'analysis',
      'profile',
      'adjudication',
    ])
    || payload.protocolVersion !== TIER_B_PROTOCOL_VERSION
    || payload.analysisVersion !== TIER_B_ANALYSIS_VERSION
    || payload.collectionAuthorized !== true) {
    add(errors, 'SCHEMA_INVALID', '/payload', 'adjudicated payload schema is invalid')
    return
  }
  if (envelope.repositoryCommit !== authorizedEnvelope.repositoryCommit
    || envelope.configurationSha256 !== authorizedEnvelope.configurationSha256) {
    add(errors, 'SIGNATURE_CONTEXT_MISMATCH', '/payload', 'adjudication must preserve the authorized commit and configuration')
  }
  if (!object(authorizedEnvelope.payload)
    || !object(restricted.payload)
    || !exactKeys(restricted.payload, ['schedule', 'manifest', 'analysisInput'])
    || !authorizedRestricted
    || !object(authorizedRestricted.payload)
    || !same(restricted.payload.schedule, authorizedRestricted.payload.schedule)) {
    add(errors, 'SCHEDULE_INVALID', '/restrictedEnvelope/payload/schedule', 'adjudication must preserve the exact authorized schedule')
    return
  }
  const hashes = validateManifest(
    restricted.payload.manifest,
    restricted.payload.schedule,
    authorizedEnvelope,
    authorizedEnvelope.payload,
    reader,
    errors,
  )
  if (!hashes || errors.length > initialErrorCount) return
  const frozenProvenanceSha256 = sha256TierB(authorizedEnvelope.payload.frozenProvenance)
  if (payload.frozenProvenanceSha256 !== frozenProvenanceSha256
    || payload.manifestSha256 !== hashes.manifestSha256
    || payload.datasetFingerprint !== hashes.datasetFingerprint) {
    add(errors, 'HASH_MISMATCH', '/payload', 'public adjudication hashes differ from the private evidence chain')
  }
  if (errors.length > initialErrorCount) return

  const analysis = payload.analysis
  const profile = payload.profile
  const adjudication = payload.adjudication
  const frozenProvenance = authorizedEnvelope.payload.frozenProvenance
  const deviceIds = object(frozenProvenance) && Array.isArray(frozenProvenance.devices)
    ? frozenProvenance.devices.filter(object).map((device) => device.deviceId)
    : []
  const manifest = object(restricted.payload) && object(restricted.payload.manifest)
    ? restricted.payload.manifest
    : {}
  const participantCount = Array.isArray(manifest.activatedParticipantSlots)
    ? manifest.activatedParticipantSlots.length
    : 0
  const derivedEligibility = validateAnalysisAndDeriveEligibility(
    analysis,
    deviceIds.filter((deviceId): deviceId is string => typeof deviceId === 'string'),
    participantCount,
    errors,
  )
  const metricKeys = TIER_B_METRIC_REGISTRY.map((metric) => metric.key)
  const profileMetrics = object(profile) && Array.isArray(profile.metrics) ? profile.metrics : []
  if (!object(profile)
    || !exactKeys(profile, [
      'schemaVersion',
      'unit',
      'consumerEligible',
      'eligibleMetricKeys',
      'metrics',
    ])
    || profile.schemaVersion !== 'tierb-reliability-profile-v1'
    || profile.unit !== 'percentage_points'
    || profile.consumerEligible !== payload.consumerEligible
    || !Array.isArray(profile.eligibleMetricKeys)
    || !same(profileMetrics.map((metric) => object(metric) ? metric.metricKey : null), metricKeys)
    || profileMetrics.some((metric, index) => {
      if (!object(metric)) return true
      if (!exactKeys(metric, [
        'metricKey',
        'decision',
        'consumerEligible',
        'consumerMdc95PercentagePoints',
      ])) return true
      const registryMetric = TIER_B_METRIC_REGISTRY[index]
      const expected = derivedEligibility.get(registryMetric.key)
      const decisionAllowed = registryMetric.status === 'excluded_design'
        ? metric.decision === 'excluded_design'
        : expected?.analysisEligible
          ? metric.decision === 'eligible' || metric.decision === 'ineligible'
          : metric.decision === 'ineligible'
      return !decisionAllowed
        || metric.consumerEligible !== (metric.decision === 'eligible')
        || metric.consumerMdc95PercentagePoints
          !== (metric.decision === 'eligible'
            ? expected?.consumerMdc95PercentagePoints
            : null)
    })) {
    add(errors, 'SCHEMA_INVALID', '/payload/profile', 'reliability profile is incomplete or uses unknown metrics')
  }
  const decisions = object(adjudication) && Array.isArray(adjudication.decisions)
    ? adjudication.decisions
    : []
  if (!object(adjudication)
    || !exactKeys(adjudication, [
      'schemaVersion',
      'analysisSha256',
      'profileSha256',
      'datasetFingerprint',
      'decisions',
    ])
    || adjudication.schemaVersion !== 'tierb-adjudication-v1'
    || adjudication.analysisSha256 !== sha256TierB(analysis)
    || adjudication.profileSha256 !== sha256TierB(profile)
    || adjudication.datasetFingerprint !== hashes.datasetFingerprint
    || !same(decisions.map((decision) => object(decision) ? decision.metricKey : null), metricKeys)
    || decisions.some((decision, index) => {
      if (!object(decision)) return true
      if (!exactKeys(decision, [
        'metricKey',
        'decision',
        'reasonCodes',
        'rationale',
        'consumerMdc95PercentagePoints',
      ])) return true
      const profileMetric = profileMetrics[index]
      return !object(profileMetric)
        || decision.decision !== profileMetric.decision
        || decision.consumerMdc95PercentagePoints
          !== profileMetric.consumerMdc95PercentagePoints
        || !Array.isArray(decision.reasonCodes)
        || decision.reasonCodes.length === 0
        || decision.reasonCodes.length > 8
        || decision.reasonCodes.some((reasonCode) =>
          typeof reasonCode !== 'string'
          || reasonCode.length > 64
          || !/^[A-Z0-9_]+$/.test(reasonCode))
        || !boundedPublicText(decision.rationale, 500)
    })) {
    add(errors, 'SCHEMA_INVALID', '/payload/adjudication', 'adjudication is not bound to the exact analysis, profile, and dataset')
  }
  const axialProfile = profileMetrics.find((metric) => object(metric) && metric.metricKey === 'pelvic_axial_rotation')
  const axialDecision = decisions.find((decision) => object(decision) && decision.metricKey === 'pelvic_axial_rotation')
  if (!object(axialProfile)
    || axialProfile.decision !== 'excluded_design'
    || axialProfile.consumerEligible !== false
    || !object(axialDecision)
    || axialDecision.decision !== 'excluded_design') {
    add(errors, 'SCHEMA_INVALID', '/payload/profile/metrics', 'pelvic axial rotation must remain excluded by design')
  }
  const eligibleKeys = profileMetrics
    .filter((metric) => object(metric) && metric.decision === 'eligible')
    .map((metric) => (metric as Record<string, unknown>).metricKey)
  const profileRecord = object(profile) ? profile : {}
  if (!same(profileRecord.eligibleMetricKeys, eligibleKeys)
    || profileRecord.consumerEligible !== (eligibleKeys.length > 0)
    || payload.consumerEligible !== profileRecord.consumerEligible) {
    add(errors, 'SCHEMA_INVALID', '/payload/profile/eligibleMetricKeys', 'consumer eligibility must derive only from eligible registered metrics')
  }
  if (errors.length > initialErrorCount) return
  validateAnalysisInputAndRecompute(
    restricted.payload.analysisInput,
    analysis,
    authorizedEnvelope,
    manifest,
    deviceIds.filter((deviceId): deviceId is string => typeof deviceId === 'string'),
    hashes.derivedMeasurements,
    errors,
  )
}

function validatePreparedPayload(payload: unknown, errors: TierBValidationError[]) {
  if (!object(payload)) {
    add(errors, 'SCHEMA_INVALID', '/payload', 'prepared payload must be an object')
    return
  }
  if (!exactKeys(payload, [
    'protocolVersion',
    'analysisVersion',
    'estimand',
    'studyDesign',
    'bootstrap',
    'metricRegistry',
    'collectionAuthorized',
    'consumerEligible',
    'frozenProvenance',
    'approvedSigningKeyIds',
  ])) {
    add(errors, 'SCHEMA_INVALID', '/payload', 'prepared payload has unknown or missing fields')
  }
  if (payload.protocolVersion !== TIER_B_PROTOCOL_VERSION) {
    add(errors, 'PROTOCOL_VERSION_MISMATCH', '/payload/protocolVersion', 'protocol version is not frozen v2')
  }
  if (payload.analysisVersion !== TIER_B_ANALYSIS_VERSION) {
    add(errors, 'ANALYSIS_VERSION_MISMATCH', '/payload/analysisVersion', 'analysis version is not frozen v1')
  }
  if (payload.estimand !== 'within-session fully-repositioned test-retest repeatability') {
    add(errors, 'SCHEMA_INVALID', '/payload/estimand', 'estimand differs from the frozen contract')
  }
  if (payload.collectionAuthorized !== false) {
    add(errors, 'PREPARED_AUTHORIZATION_FORBIDDEN', '/payload/collectionAuthorized', 'prepared data cannot authorize collection')
  }
  if (payload.consumerEligible !== false) {
    add(errors, 'PREPARED_ELIGIBILITY_FORBIDDEN', '/payload/consumerEligible', 'prepared data cannot be consumer eligible')
  }
  if (payload.frozenProvenance !== null) {
    add(errors, 'PREPARED_PROVENANCE_FORBIDDEN', '/payload/frozenProvenance', 'prepared data cannot freeze real collection provenance')
  }
  if (!Array.isArray(payload.approvedSigningKeyIds) || payload.approvedSigningKeyIds.length !== 0) {
    add(errors, 'PREPARED_SIGNING_KEYS_FORBIDDEN', '/payload/approvedSigningKeyIds', 'prepared data must not approve signing keys')
  }
  if (!same(payload.metricRegistry, TIER_B_METRIC_REGISTRY)) {
    add(errors, 'SCHEMA_INVALID', '/payload/metricRegistry', 'metric registry differs from the frozen contract')
  }
  const design = payload.studyDesign
  const validDesign = object(design)
    && exactKeys(design, [
      'cohort',
      'minimumParticipantsPerDevice',
      'targetParticipantsPerDevice',
      'exactDeviceCount',
      'sameParticipantsOnBothDevices',
      'repeatIds',
      'views',
      'fullRestanceBetweenRepeats',
      'expectedMinimumPhotoRows',
      'manifestMissingRowsAllowed',
      'maxMetricMissingCellFraction',
      'primaryUnit',
      'deviceOrderPolicy',
      'viewOrderPolicy',
    ])
    && design.cohort === 'primary_neutral'
    && design.minimumParticipantsPerDevice === 12
    && design.targetParticipantsPerDevice === 15
    && design.exactDeviceCount === 2
    && design.sameParticipantsOnBothDevices === true
    && same(design.repeatIds, TIER_B_REPEAT_IDS)
    && same(design.views, TIER_B_VIEWS)
    && design.fullRestanceBetweenRepeats === true
    && design.expectedMinimumPhotoRows === 288
    && design.manifestMissingRowsAllowed === 0
    && design.maxMetricMissingCellFraction === 0.2
    && design.primaryUnit === 'percentage_points'
    && design.deviceOrderPolicy === 'counterbalanced'
    && design.viewOrderPolicy === 'counterbalanced-four-sequence-v1'
  if (!validDesign) add(errors, 'SCHEMA_INVALID', '/payload/studyDesign', 'study design differs from the frozen contract')

  const bootstrap = payload.bootstrap
  const validBootstrap = object(bootstrap)
    && exactKeys(bootstrap, [
      'algorithm',
      'attempts',
      'minimumValidAttempts',
      'intervalMethod',
      'invalidAttemptsRetried',
      'seed',
    ])
    && bootstrap.algorithm === 'participant-cluster-sha256-counter-v1'
    && bootstrap.attempts === 10_000
    && bootstrap.minimumValidAttempts === 9_500
    && bootstrap.intervalMethod === 'percentile-95-type7'
    && bootstrap.invalidAttemptsRetried === false
    && boundedPublicText(bootstrap.seed, 128)
  if (!validBootstrap) add(errors, 'SCHEMA_INVALID', '/payload/bootstrap', 'bootstrap contract differs from the frozen contract')
}

function sortErrors(errors: TierBValidationError[]) {
  errors.sort((left, right) =>
    left.code.localeCompare(right.code) || left.path.localeCompare(right.path),
  )
}

export function validateTierBChain(input: ValidateTierBChainInput): TierBValidationResult {
  const errors: TierBValidationError[] = []
  const expectedStates: TierBState[] = ['prepared', 'collection_authorized', 'adjudicated']
  const final = input.envelopes.at(-1)?.publicEnvelope
  const expectedTrustPolicyEnvironment = input.expectedTrustPolicyEnvironment ?? 'production'

  if (sha256TierB(input.trustPolicy) !== input.expectedTrustPolicySha256) {
    add(errors, 'TRUST_POLICY_HASH_MISMATCH', '/trustPolicy', 'trust policy does not match its independent pin')
  }
  if (!object(input.trustPolicy)
    || input.trustPolicy.schemaVersion !== TIER_B_TRUST_POLICY_VERSION
    || input.trustPolicy.trustDomain !== 'posture-ai-tierb-reliability'
    || !Array.isArray(input.trustPolicy.keys)) {
    add(errors, 'SCHEMA_INVALID', '/trustPolicy', 'trust policy schema is invalid')
  } else {
    validateTrustPolicy(input.trustPolicy, errors)
    if (input.trustPolicy.environment !== expectedTrustPolicyEnvironment) {
      add(
        errors,
        'SCHEMA_INVALID',
        '/trustPolicy/environment',
        `expected ${expectedTrustPolicyEnvironment} trust policy`,
      )
    }
  }
  if (input.envelopes.length === 0 || input.envelopes.length > expectedStates.length) {
    add(errors, 'STATE_TRANSITION_INVALID', '/envelopes', 'chain must contain one to three ordered lifecycle states')
  }

  input.envelopes.forEach((entry, index) => {
    const envelope = entry.publicEnvelope
    const path = `/envelopes/${index}`
    if (!object(envelope)
      || !exactKeys(envelope, [
        'schemaVersion',
        'packetId',
        'state',
        'parentPublicEnvelopeSha256',
        'repositoryCommit',
        'configurationSha256',
        'restrictedEnvelopeSha256',
        'payload',
        'payloadSha256',
        'transition',
      ])
      || envelope.schemaVersion !== TIER_B_PUBLIC_ENVELOPE_VERSION
      || envelope.state !== expectedStates[index]
      || !boundedPublicText(envelope.packetId, 128)) {
      add(errors, 'SCHEMA_INVALID', `${path}/publicEnvelope`, 'public envelope schema or lifecycle position is invalid')
      return
    }
    scanPublicPrivacy(envelope, `${path}/publicEnvelope`, errors)
    if (!SHA256.test(envelope.payloadSha256) || sha256TierB(envelope.payload) !== envelope.payloadSha256) {
      add(errors, 'HASH_MISMATCH', `${path}/publicEnvelope/payloadSha256`, 'public payload hash does not match canonical payload')
    }

    if (index === 0) {
      if (envelope.parentPublicEnvelopeSha256 !== null) {
        add(errors, 'PARENT_ENVELOPE_HASH_MISMATCH', `${path}/publicEnvelope/parentPublicEnvelopeSha256`, 'prepared envelope cannot have a parent')
      }
    } else {
      const parent = input.envelopes[index - 1].publicEnvelope
      if (envelope.packetId !== parent.packetId) {
        add(errors, 'PACKET_ID_MISMATCH', `${path}/publicEnvelope/packetId`, 'packet id changed across lifecycle transition')
      }
      if (envelope.parentPublicEnvelopeSha256 !== sha256TierB(parent)) {
        add(errors, 'PARENT_ENVELOPE_HASH_MISMATCH', `${path}/publicEnvelope/parentPublicEnvelopeSha256`, 'parent envelope hash is stale or mismatched')
      }
    }

    if (envelope.state === 'prepared') {
      if (entry.restrictedEnvelope !== undefined || envelope.restrictedEnvelopeSha256 !== null) {
        add(errors, 'RESTRICTED_ENVELOPE_UNEXPECTED', `${path}/restrictedEnvelope`, 'prepared state cannot carry restricted evidence')
      }
      if (envelope.repositoryCommit !== null || envelope.configurationSha256 !== null || envelope.transition !== null) {
        add(errors, 'STATE_TRANSITION_INVALID', `${path}/publicEnvelope`, 'prepared state cannot carry signed transition provenance')
      }
      validatePreparedPayload(envelope.payload, errors)
    } else {
      if (!entry.restrictedEnvelope || !envelope.restrictedEnvelopeSha256) {
        add(errors, 'RESTRICTED_ENVELOPE_REQUIRED', `${path}/restrictedEnvelope`, `${envelope.state} requires restricted evidence`)
      } else if (sha256TierB(entry.restrictedEnvelope) !== envelope.restrictedEnvelopeSha256) {
        add(errors, 'RESTRICTED_ENVELOPE_HASH_MISMATCH', `${path}/publicEnvelope/restrictedEnvelopeSha256`, 'restricted envelope hash does not match')
      }
      if (!COMMIT.test(envelope.repositoryCommit ?? '') || !SHA256.test(envelope.configurationSha256 ?? '')) {
        add(errors, 'SCHEMA_INVALID', `${path}/publicEnvelope`, `${envelope.state} requires exact commit and configuration hashes`)
      }
      const parent = input.envelopes[index - 1]?.publicEnvelope
      const restricted = entry.restrictedEnvelope
      if (parent && restricted) {
        if (!exactKeys(restricted, [
          'schemaVersion',
          'packetId',
          'state',
          'parentPublicEnvelopeSha256',
          'privacyClass',
          'payload',
        ])
          || restricted.schemaVersion !== TIER_B_RESTRICTED_ENVELOPE_VERSION
          || restricted.packetId !== envelope.packetId
          || restricted.state !== envelope.state
          || restricted.parentPublicEnvelopeSha256 !== sha256TierB(parent)
          || restricted.privacyClass !== 'restricted-local') {
          add(errors, 'SCHEMA_INVALID', `${path}/restrictedEnvelope`, 'restricted envelope is not bound to the exact transition parent')
        }
        validateTransition(envelope, parent, restricted, input.trustPolicy, input.now, `${path}/publicEnvelope`, errors)
        if (envelope.state === 'collection_authorized') {
          validateAuthorizedPayload(envelope.payload, envelope, restricted, errors)
        } else {
          const authorizedEntry = input.envelopes[index - 1]
          if (envelope.transition?.signature.keyId === parent.transition?.signature.keyId) {
            add(errors, 'SIGNER_SEPARATION_REQUIRED', `${path}/publicEnvelope/transition/signature/keyId`, 'collection authorization and statistical adjudication require distinct signers')
          }
          validateAdjudicatedPayload(
            envelope.payload,
            envelope,
            restricted,
            parent,
            authorizedEntry?.restrictedEnvelope,
            input.artifactReader,
            errors,
          )
        }
      }
    }
  })

  if (!final || final.state !== input.expectedState) {
    add(errors, 'LIFECYCLE_MISMATCH', '/expectedState', 'validated chain does not end in the requested state')
  }

  sortErrors(errors)
  if (errors.length > 0 || !final) {
    return {
      ok: false,
      state: final?.state ?? null,
      collectionAuthorized: false,
      consumerEligible: false,
      errors,
    }
  }
  const payload = object(final.payload) ? final.payload : {}
  return {
    ok: true,
    state: final.state,
    collectionAuthorized: payload.collectionAuthorized === true,
    consumerEligible: payload.consumerEligible === true,
    errors: [],
  }
}
