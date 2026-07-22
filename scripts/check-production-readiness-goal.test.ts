import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  computeManifestConfigurationHash,
  computeSourceInventoryHash,
  validateManifestContract,
  validateProductionReadiness,
} from './check-production-readiness-goal.mjs'

type DynamicJson = ReturnType<JSON['parse']>
type JsonObject = Record<string, DynamicJson>
type Patch = { op: 'set' | 'remove'; path: string; value?: unknown }
type FailureCase = { name: string; mode: 'build' | 'launch'; patches: Patch[]; expected_error: string }
type ValidationResult = { autonomous_build_complete: boolean; launch_authorized: boolean; errors: string[] }

const runReadinessValidator = validateProductionReadiness as unknown as (input: JsonObject) => ValidationResult

const ROOT = resolve(import.meta.dirname, '..')
const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'production-readiness')
const CHECKER = join(import.meta.dirname, 'check-production-readiness-goal.mjs')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'docs/qa/production-readiness-manifest.json'), 'utf8'))
const SOURCE_INVENTORY = JSON.parse(readFileSync(join(FIXTURE_DIR, 'source-inventory.json'), 'utf8'))
const BASE = JSON.parse(readFileSync(join(FIXTURE_DIR, 'base-valid.json'), 'utf8'))
const FAILURE_CASES = JSON.parse(readFileSync(join(FIXTURE_DIR, 'failure-cases.json'), 'utf8')) as FailureCase[]
const HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
const ANCESTOR_COMMIT = spawnSync('git', ['rev-parse', 'HEAD^'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
const PLAYWRIGHT_LIST = spawnSync('npx', ['playwright', 'test', '--list'], { cwd: ROOT, encoding: 'utf8' })
const HG04_REVIEW_KEY = generateKeyPairSync('ed25519')
const HG04_REVIEW_FINGERPRINT = createHash('sha256').update(HG04_REVIEW_KEY.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
const REBOUND_TASKS = ['PR-00', 'PR-01', 'PR-02', 'PR-03', 'PR-04', 'PR-05', 'PR-06', 'PR-07']

function clone<T>(value: T): T {
  return structuredClone(value)
}

function artifactContent(path: string, manifest: JsonObject): string {
  if (path.endsWith('/playwright-list.json')) {
    return JSON.stringify({
      format: 'playwright-json-list',
      inventory_id: manifest.e2e.inventory_id,
      project_order: manifest.e2e.project_order,
      projects: manifest.e2e.projects,
      expected_total: manifest.e2e.expected_total,
      expected_files: manifest.e2e.expected_files,
      inventory_hash: manifest.e2e.inventory_hash,
    })
  }
  return `production-readiness receipt: ${path}\n`
}

function taskApplicability(task: JsonObject, boundary: JsonObject): 'applicable' | 'not_applicable' {
  const expression = task.applicability.expression
  const value = (variable: JsonObject) => boundary[String(variable.var).replace('release_boundary.', '')]
  const applies = expression.constant === true
    || (Array.isArray(expression.eq) && value(expression.eq[0]) === expression.eq[1])
    || (Array.isArray(expression.any_true) && expression.any_true.some((variable: JsonObject) => Boolean(value(variable))))
  return applies ? 'applicable' : task.applicability.default_state
}

function validInput({ freezeHuman = false, includeHg04Evidence = true } = {}): JsonObject {
  const manifest = clone(MANIFEST)
  const artifacts: JsonObject = {}
  const ref = (path: string, explicitContent?: string, extra: JsonObject = {}) => {
    const content = explicitContent ?? artifactContent(path, manifest)
    const sha256 = createHash('sha256').update(content).digest('hex')
    artifacts[path] = { is_regular_file: true, is_symlink: false, within_proof_root: true, sha256, content }
    return { path, sha256, ...extra }
  }

  for (const finding of manifest.audit_findings) {
    finding.status = 'completed'
    finding.outcome = finding.applicability.state === 'not_applicable' ? 'not_applicable' : 'passed'
    finding.proof = [ref(`proof/${finding.engineering_task}/${finding.id}.json`)]
  }
  for (const criterion of manifest.criteria) {
    const definition = manifest.tasks.find((task: JsonObject) => task.id === criterion.task_id)
    const applicability = taskApplicability(definition, manifest.release_boundary)
    criterion.status = 'completed'
    criterion.outcome = applicability === 'applicable' ? 'passed' : 'not_applicable'
  }

  const tasks = manifest.criteria.map((criterion: JsonObject) => {
    const definition = manifest.tasks.find((task: JsonObject) => task.id === criterion.task_id)
    const applicability = taskApplicability(definition, manifest.release_boundary)
    const isFrozen = freezeHuman && criterion.kind !== 'engineering'
    const proofManifest = ref(`proof/${criterion.id}.txt`)
    return {
      id: criterion.task_id,
      kind: criterion.kind,
      dependencies: criterion.dependencies,
      maps_to_criterion: criterion.id,
      status: isFrozen ? 'frozen' : 'completed',
      outcome: isFrozen ? null : (applicability === 'applicable' ? 'passed' : 'not_applicable'),
      attempts: criterion.kind === 'engineering' ? 1 : 0,
      applicability,
      applicability_reason: SOURCE_INVENTORY.state_task_contracts.find((row: JsonObject) => row.id === criterion.task_id).applicability_reason,
      proof_manifest: proofManifest.path,
      proof_manifest_sha256: proofManifest.sha256,
      review_verdict: isFrozen ? null : 'PASS',
      last_decision: isFrozen ? 'Owner deferred this exact launch gate.' : 'fixture task completed with independent proof',
      commit: HEAD,
      changed_files: [],
      allowed_changed_files: [],
    }
  })

  const commit = HEAD
  const configHash = manifest.configuration_hash
  const proofs = Object.fromEntries(manifest.criteria.map((criterion: JsonObject) => {
    const taskId = String(criterion.task_id)
    const task = tasks.find((row: JsonObject) => row.id === taskId)
    if (task.status === 'frozen') return [taskId, null]
    const commands = taskId === 'PR-17'
      ? [...manifest.ci_contract.global_commands, ...manifest.ci_contract.pr17_additional_commands]
      : ['npx vitest run']
    const proof: JsonObject = {
      task_id: taskId,
      manifest_path: task.proof_manifest,
      manifest_sha256: task.proof_manifest_sha256,
      criteria_evidence: [{ criterion_id: criterion.id, evidence: [ref(`proof/${taskId}/acceptance.json`)] }],
      commands: commands.map((command: string, index: number) => ({ command, exit_code: 0, receipt: ref(`proof/${taskId}/command-${index}.json`, JSON.stringify({ task_id: taskId, command, exit_code: 0, commit })) })),
      review: { verdict: 'PASS', reviewer: 'independent-reviewer', independent: true, receipt: ref(`proof/${taskId}/review.json`, JSON.stringify({ task_id: taskId, verdict: 'PASS', reviewer: 'independent-reviewer', independent: true, commit, configuration_hash: configHash })) },
      rollback: { notes: 'Revert the task change set as one unit.', verified: true, receipt: ref(`proof/${taskId}/rollback.json`) },
      commit,
      changed_files: [],
      allowed_changed_files: [],
      commit_receipt: ref(`proof/${taskId}/commit.json`, JSON.stringify({ task_id: taskId, commit })),
      changed_files_receipt: ref(`proof/${taskId}/changed-files.json`, JSON.stringify({ task_id: taskId, commit, changed_files: [], allowed_changed_files: [] })),
    }
    if (criterion.kind !== 'engineering') proof.receipt = ref(`proof/${taskId}/signed-receipt.json`, JSON.stringify({ task_id: taskId, verified: true, commit }), { verified: true })
    return [taskId, proof]
  }).filter((entry: [string, JsonObject | null]) => entry[1] !== null))

  const releaseEvidence = clone(BASE.release_evidence)
  releaseEvidence.configuration = {
    expected_hash: configHash,
    actual_hash: configHash,
    environment: 'intended-beta',
    test_only_flags: [],
    environment_variables: {
      NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: false,
    },
    hg04_approved_reviewer_public_key_fingerprints: [HG04_REVIEW_FINGERPRINT],
    receipt: ref('proof/HG-09/configuration.json'),
  }
  replaceArtifactContent({ artifacts }, releaseEvidence.configuration.receipt, JSON.stringify({
    commit,
    configuration_hash: configHash,
    hg04_approved_reviewer_public_key_fingerprints: [HG04_REVIEW_FINGERPRINT],
  }))
  releaseEvidence.ci.commit = commit
  releaseEvidence.ci.receipt = ref('proof/PR-17/ci.json', JSON.stringify(releaseEvidence.ci))
  releaseEvidence.repository.head_sha = commit
  releaseEvidence.repository.expected_sha = commit
  releaseEvidence.repository.porcelain_receipt = ref('proof/PR-17/porcelain.json', JSON.stringify({ command: 'git status --porcelain=v1 --untracked-files=all', head_sha: commit, output: '', changed_files: [] }))
  releaseEvidence.repository.diff_receipt = ref('proof/PR-17/diff-check.json', JSON.stringify({ command: 'git diff --check', head_sha: commit, exit_code: 0 }))
  const councilReceipts = ['Codex', 'Fable 5 medium', 'Kimi K3'].map(seat => ({ seat, receipt: ref(`proof/HG-09/council-${seat.replaceAll(' ', '-').toLowerCase()}.json`, JSON.stringify({ seat, verdict: 'GO', commit, configuration_hash: configHash })) }))
  releaseEvidence.rehearsal = {
    id: manifest.intended_beta_rehearsal_contract.id,
    commit,
    configuration_hash: configHash,
    completed_at: BASE.release_evidence.rehearsal.completed_at,
    environment: 'intended-beta',
    test_mode: false,
    test_flags_off: true,
    environment_variables: {},
    journey_evidence: ref('proof/HG-09/journey.json'),
    provider_receipts: [ref('proof/HG-09/provider-state.json')],
    legal_version: 'invite-beta-2026-07-19',
    clinical_gate_state: 'not_applicable',
    council_receipts: councilReceipts.map(row => row.receipt),
    command: 'npm run release:rehearse',
    exit_code: 0,
  }
  releaseEvidence.rehearsal.receipt = ref('proof/HG-09/intended-beta-rehearsal.json', JSON.stringify({
    id: releaseEvidence.rehearsal.id,
    command: releaseEvidence.rehearsal.command,
    exit_code: releaseEvidence.rehearsal.exit_code,
    commit,
    configuration_hash: configHash,
    environment: releaseEvidence.rehearsal.environment,
    test_mode: false,
    test_flags_off: true,
  }))
  releaseEvidence.rehearsal.configuration_receipt = ref('proof/HG-09/intended-beta-configuration.json', JSON.stringify({ commit, configuration_hash: configHash, environment: 'intended-beta', environment_variables: {} }))
  releaseEvidence.council = councilReceipts.map(({ seat, receipt }) => ({ seat, verdict: 'GO', resolved: true, commit, configuration_hash: configHash, receipt }))
  releaseEvidence.flakes = []
  const executedReport = executedPlaywrightReport({ state: { commit }, manifest })
  releaseEvidence.e2e = {
    inventory_id: manifest.e2e.inventory_id,
    inventory_hash: manifest.e2e.inventory_hash,
    projects: clone(manifest.e2e.projects),
    inventory_format: 'playwright-json-list',
    inventory_receipt: ref('proof/PR-17/playwright-list.json'),
    report_format: manifest.executed_playwright_report_contract.report_format,
    report_receipt: ref('proof/PR-17/playwright-report.json', JSON.stringify(executedReport)),
    commit,
    configuration_hash: configHash,
    status: 'passed',
    started_at: executedReport.started_at,
    completed_at: executedReport.completed_at,
    observed_skips: [],
    retry_results: [],
  }
  const finalAudit = manifest.source_contracts[0]
  const finalAuditReceipt = ref('proof/HG-10/final-audit.json', JSON.stringify({ id: finalAudit.id, sha256: finalAudit.sha256, commit, configuration_hash: configHash, verified: true }))
  const rollbackPacketReceipt = ref('proof/HG-10/rollback-packet.json', JSON.stringify({ task_id: 'HG-10', commit, configuration_hash: configHash, verified: true }))
  const ownerApproval = {
    ...releaseEvidence.owner_approval,
    commit,
    configuration_hash: configHash,
  }
  releaseEvidence.owner_approval = {
    ...ownerApproval,
    receipt: ref('proof/HG-10/owner-approval.json', JSON.stringify({
      id: manifest.owner_approval_contract.id,
      task_id: 'HG-10',
      decision: 'approve-production-promotion',
      approved_at: ownerApproval.approved_at,
      approver: 'product-owner',
      commit,
      ci_run_id: releaseEvidence.ci.run_id,
      ci_url: releaseEvidence.ci.url,
      ci_status: releaseEvidence.ci.status,
      configuration_hash: configHash,
      manifest_hash: createHash('sha256').update(stableJson(manifest)).digest('hex'),
      final_audit_id: finalAudit.id,
      final_audit_hash: finalAudit.sha256,
      final_audit_receipt: finalAuditReceipt,
      rollback_packet_receipt: rollbackPacketReceipt,
    })),
  }

  const hg04Proof = proofs['HG-04']
  if (includeHg04Evidence && hg04Proof !== null && typeof hg04Proof === 'object' && !Array.isArray(hg04Proof)) {
    const deviceContract = SOURCE_INVENTORY.runtime_source_contracts.find((row: JsonObject) => row.path === 'docs/qa/device-release-contract.json')
    const deviceValidator = SOURCE_INVENTORY.runtime_source_contracts.find((row: JsonObject) => row.path === 'scripts/check-device-evidence.mjs')
    const deviceSchema = SOURCE_INVENTORY.runtime_source_contracts.find((row: JsonObject) => row.path === 'docs/qa/device-evidence.schema.json')
    const deterministicSamples = {
      hashes: ['4'.repeat(64)],
      fields: {
        sampled_core_run_ids: ['iphone-cold', 'iphone-warm', 'android-cold', 'android-warm'],
        sampled_device_classes: ['iphone_safari', 'android_chrome'],
        sampled_exclusion_keys: ['iphone_safari:workout_audio', 'android_chrome:workout_audio'],
        sampled_remaining_row_keys: ['iphone_safari:screen_reader', 'android_chrome:screen_reader'],
      },
    }
    const validation = {
      task_id: 'HG-04',
      status: 'PASS',
      commit,
      configuration_hash: configHash,
      contract_sha256: deviceContract?.sha256,
      validator_sha256: deviceValidator?.sha256,
      schema_sha256: deviceSchema?.sha256,
      packet_sha256: '2'.repeat(64),
      evidence_root_manifest_sha256: '3'.repeat(64),
      packet_structurally_valid: true,
      physical_packet_valid: true,
      hg04_launch_eligible: false,
      validator_is_necessary_not_sufficient: true,
      reason_codes: [],
      mode: 'physical',
      fixture: false,
      test_mode: false,
      operator_id: 'device-operator',
      approved_reviewer_public_key_fingerprints: [HG04_REVIEW_FINGERPRINT],
      deterministic_samples: deterministicSamples,
      collection_completed_at: '2026-07-19T23:00:00.000Z',
    }
    const review = {
      task_id: 'HG-04',
      verdict: 'PASS',
      review_id: 'hg04-independent-review',
      reviewer_id: 'independent-device-reviewer',
      operator_id: validation.operator_id,
      commit,
      configuration_hash: configHash,
      contract_sha256: validation.contract_sha256,
      packet_sha256: validation.packet_sha256,
      evidence_root_manifest_sha256: validation.evidence_root_manifest_sha256,
      reviewed_at: '2026-07-19T23:10:00.000Z',
      sampled_artifact_sha256: deterministicSamples.hashes,
      ...deterministicSamples.fields,
      coverage: {
        all_four_core_recordings: true,
        both_device_identity_artifacts: true,
        every_exclusion: true,
        deterministic_remaining_rows: true,
      },
    }
    const reviewPacket = {
      receipt: review,
      signature: {
        algorithm: 'Ed25519',
        key_class: 'production',
        public_key_pem: HG04_REVIEW_KEY.publicKey.export({ type: 'spki', format: 'pem' }),
        public_key_fingerprint: HG04_REVIEW_FINGERPRINT,
        value_base64: sign(null, Buffer.from(stableJson(review)), HG04_REVIEW_KEY.privateKey).toString('base64'),
      },
    }
    const transition = {
      task_id: 'HG-04',
      human_owned: true,
      from_status: 'frozen',
      to_status: 'completed',
      verified: true,
      transitioned_by: 'release-owner',
      transitioned_at: '2026-07-19T23:20:00.000Z',
      commit,
      configuration_hash: configHash,
    }
    hg04Proof.device_evidence = {
      validator_receipt: ref('proof/HG-04/device-validation.json', JSON.stringify(validation)),
      independent_review_receipt: ref('proof/HG-04/independent-sampling-review.json', JSON.stringify(reviewPacket)),
      human_transition_receipt: ref('proof/HG-04/human-transition.json', JSON.stringify(transition)),
    }
  }

  const frozen = tasks.filter((task: JsonObject) => task.status === 'frozen').map((task: JsonObject) => ({
    ...SOURCE_INVENTORY.frozen_gate_contracts.find((contract: JsonObject) => contract.task_id === task.id),
  }))

  const state = {
    slug: 'posture-ai-production-readiness',
    commit,
    proof_dir: '/tmp/posture-readiness/proof',
    criteria: SOURCE_INVENTORY.criterion_ids.map((id: string) => ({ id })),
    tasks,
    frozen,
    completed: tasks.filter((task: JsonObject) => task.status === 'completed').map((task: JsonObject) => task.id),
    current_task_id: null,
    proofs,
    release_evidence: releaseEvidence,
  }
  const canonicalStatePath = resolve(homedir(), '.claude/goal-state/posture-ai-production-readiness/state.json')

  const actualSources = {
    files: [...SOURCE_INVENTORY.source_contracts, ...SOURCE_INVENTORY.runtime_source_contracts].map((contract: JsonObject) => {
      const path = String(contract.path).startsWith('~/') ? resolve(homedir(), String(contract.path).slice(2)) : resolve(ROOT, contract.path)
      return { id: contract.id, path: contract.path, resolved_path: path, is_regular_file: true, is_symlink: false, within_allowed_root: true, content: readFileSync(path, 'utf8') }
    }),
    validation_state: { requested_path: canonicalStatePath, resolved_path: canonicalStatePath, is_regular_file: true, is_symlink: false, content: JSON.stringify(state) },
    playwright: { command: SOURCE_INVENTORY.playwright_inventory.command, exit_code: PLAYWRIGHT_LIST.status, stdout: PLAYWRIGHT_LIST.stdout, stderr: PLAYWRIGHT_LIST.stderr },
  }

  const liveRepository = {
    remote_url: SOURCE_INVENTORY.repository_identity.remote_url,
    audited_commit: SOURCE_INVENTORY.repository_identity.audited_commit,
    audited_commit_exists: true,
    head_sha: commit,
    head_commit_exists: true,
    worktree_clean: true,
    porcelain: '',
    changed_files: [],
    diff_check_exit_code: 0,
    task_commits: tasks.filter((task: JsonObject) => task.status === 'completed').map((task: JsonObject) => ({ task_id: task.id, commit: task.commit, exists: true, reachable_from_head: true })),
  }

  return {
    now: BASE.now,
    sourceInventory: clone(SOURCE_INVENTORY),
    manifest,
    state,
    artifacts,
    actualSources,
    liveRepository,
  }
}

function applyPatch(target: JsonObject, patch: Patch): void {
  const parts = patch.path.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
  let cursor: DynamicJson = target
  for (const part of parts.slice(0, -1)) cursor = Array.isArray(cursor) ? cursor[Number(part)] : cursor[part]
  const leaf = parts.at(-1)!
  if (Array.isArray(cursor)) {
    if (patch.op === 'remove') cursor.splice(Number(leaf), 1)
    else cursor[Number(leaf)] = patch.value
  } else if (patch.op === 'remove') delete cursor[leaf]
  else cursor[leaf] = patch.value
}

function validate(mode: 'build' | 'launch', input: JsonObject) {
  input.actualSources.validation_state.content = JSON.stringify(input.state)
  return runReadinessValidator({ mode, ...input })
}

function replaceArtifactContent(input: JsonObject, reference: JsonObject, content: string): void {
  const sha256 = createHash('sha256').update(content).digest('hex')
  reference.sha256 = sha256
  input.artifacts[reference.path] = { ...input.artifacts[reference.path], content, sha256 }
}

function addArtifact(input: JsonObject, path: string, content: string): JsonObject {
  const sha256 = createHash('sha256').update(content).digest('hex')
  input.artifacts[path] = { is_regular_file: true, is_symlink: false, within_proof_root: true, content, sha256 }
  return { path, sha256 }
}

function mutateExecutedPlaywrightReport(input: JsonObject, mutate: (report: JsonObject) => void): void {
  const reference = input.state.release_evidence.e2e.report_receipt
  const report = JSON.parse(input.artifacts[reference.path].content)
  mutate(report)
  replaceArtifactContent(input, reference, JSON.stringify(report))
}

function mutateSignedHg04Review(input: JsonObject, mutate: (receipt: JsonObject) => void): void {
  const reference = input.state.proofs['HG-04'].device_evidence.independent_review_receipt
  const packet = JSON.parse(input.artifacts[reference.path].content)
  mutate(packet.receipt)
  packet.signature.value_base64 = sign(null, Buffer.from(stableJson(packet.receipt)), HG04_REVIEW_KEY.privateKey).toString('base64')
  replaceArtifactContent(input, reference, JSON.stringify(packet))
}

function setTaskCommit(input: JsonObject, taskId: string, commit: string): void {
  const task = input.state.tasks.find((row: JsonObject) => row.id === taskId)
  const proof = input.state.proofs[taskId]
  task.commit = commit
  proof.commit = commit
  replaceArtifactContent(input, proof.commit_receipt, JSON.stringify({ task_id: taskId, commit }))
  replaceArtifactContent(input, proof.changed_files_receipt, JSON.stringify({ task_id: taskId, commit, changed_files: proof.changed_files, allowed_changed_files: proof.allowed_changed_files }))
  for (const command of proof.commands) replaceArtifactContent(input, command.receipt, JSON.stringify({ task_id: taskId, command: command.command, exit_code: command.exit_code, commit }))
  const review = JSON.parse(input.artifacts[proof.review.receipt.path].content)
  review.commit = commit
  replaceArtifactContent(input, proof.review.receipt, JSON.stringify(review))
  const live = input.liveRepository.task_commits.find((row: JsonObject) => row.task_id === taskId)
  live.commit = commit
}

function setOwnerApprovalTimestamp(input: JsonObject, approvedAt: string): void {
  const approval = input.state.release_evidence.owner_approval
  approval.approved_at = approvedAt
  const receipt = JSON.parse(input.artifacts[approval.receipt.path].content)
  receipt.approved_at = approvedAt
  replaceArtifactContent(input, approval.receipt, JSON.stringify(receipt))
}

function applyPr11NotApplicable(input: JsonObject, { consumerActive = false, includeExclusionEvidence = true } = {}): void {
  const contract = input.manifest.not_applicable_completion_contracts['PR-11']
  const task = input.state.tasks.find((row: JsonObject) => row.id === 'PR-11')
  const criterion = input.manifest.criteria.find((row: JsonObject) => row.task_id === 'PR-11')
  const hg05 = input.state.tasks.find((row: JsonObject) => row.id === 'HG-05')
  task.outcome = 'not_applicable'
  criterion.outcome = 'not_applicable'
  const common = { commit: input.state.commit, configuration_hash: input.manifest.configuration_hash }
  const profileInventoryReceipt = addArtifact(input, 'proof/PR-11/no-eligible-profile.json', JSON.stringify({ task_id: 'PR-11', eligible_hg05_profile_count: 0, verified: true, ...common }))
  const hg05StateReceipt = addArtifact(input, 'proof/PR-11/hg05-state.json', JSON.stringify({ task_id: 'HG-05', status: hg05.status, outcome: hg05.outcome, verified: true, ...common }))
  const exclusionEvidence = includeExclusionEvidence
    ? [addArtifact(input, 'proof/PR-11/exclusion.json', JSON.stringify({ contract_id: contract.id, reason_category: 'no-eligible-hg05-reliability-profile', verified: true, ...common }))]
    : []
  const consumerFailClosedReceipt = addArtifact(input, 'proof/PR-11/consumer-fail-closed.json', JSON.stringify({ consumer_eligible_profile_active: consumerActive, mode: 'fixed-fallback', verified: true, ...common }))
  const reviewReceipt = addArtifact(input, 'proof/PR-11/not-applicable-review.json', JSON.stringify({ task_id: 'PR-11', verdict: 'PASS', reviewer: 'independent-reliability-reviewer', independent: true, contract_id: contract.id, ...common }))
  input.state.proofs['PR-11'].not_applicable = {
    contract_id: contract.id,
    reason_category: 'no-eligible-hg05-reliability-profile',
    eligible_hg05_profile_count: 0,
    profile_inventory_receipt: profileInventoryReceipt,
    hg05_state_receipt: hg05StateReceipt,
    exclusion_evidence: exclusionEvidence,
    consumer_fail_closed_receipt: consumerFailClosedReceipt,
    independent_review: { verdict: 'PASS', reviewer: 'independent-reliability-reviewer', independent: true, receipt: reviewReceipt },
  }
}

function executedPlaywrightReport(input: JsonObject): JsonObject {
  const rows = String(PLAYWRIGHT_LIST.stdout).split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s+\[([^\]]+)\] › (.+?):\d+:\d+ › (.+)$/)
    return match ? [{ project: match[1], file: match[2].includes('/') ? match[2] : `e2e/${match[2]}`, title: match[3] }] : []
  })
  const expectedAxeTargets = input.manifest.e2e.axe_receipts.projects.flatMap((project: string) => (
    input.manifest.e2e.axe_receipts.scans.map((scan: JsonObject) => ({
      project,
      surface: scan.surface,
      path: scan.path,
      originating_test: { project, file: scan.originating_test.file, title: scan.originating_test.title },
    }))
  )).concat(input.manifest.e2e.axe_receipts.targets).sort((left: JsonObject, right: JsonObject) => (
    stableJson(left).localeCompare(stableJson(right))
  ))
  return {
    format: input.manifest.executed_playwright_report_contract.report_format,
    command: input.manifest.ci_contract.engineering_e2e_only,
    commit: input.state.commit,
    configuration_hash: input.manifest.configuration_hash,
    inventory_id: input.manifest.e2e.inventory_id,
    inventory_hash: input.manifest.e2e.inventory_hash,
    project_order: input.manifest.e2e.project_order,
    projects: input.manifest.e2e.projects,
    expected_total: input.manifest.e2e.expected_total,
    expected_files: input.manifest.e2e.expected_files,
    status: 'passed',
    started_at: '2026-07-19T22:30:00.000Z',
    completed_at: '2026-07-19T22:40:00.000Z',
    tests: rows.map(row => ({ ...row, annotations: [], results: [{ retry: 0, status: 'passed' }] })),
    observed_skips: [],
    retry_results: [],
    skip_validation_failures: [],
    a11y_receipt_failures: [],
    axe_receipt_validation: {
      schema_version: input.manifest.e2e.axe_receipts.schema_version,
      manifest_expected_total: input.manifest.e2e.axe_receipts.expected_total,
      expected_run_total: expectedAxeTargets.length,
      materialized_total: expectedAxeTargets.length,
      expected_run_targets: expectedAxeTargets,
      materialized_targets: expectedAxeTargets,
      status: 'passed',
    },
  }
}

function stableJson(value: DynamicJson): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function coordinatedE2eHash(e2e: JsonObject): string {
  const payload = Object.fromEntries([
    'inventory_id', 'source_config', 'source_runner', 'inventory_command', 'project_order', 'projects',
    'expected_total', 'expected_files', 'execution', 'retry_policy', 'axe_receipts', 'approved_skips', 'skip_policy',
  ].map(key => [key, e2e[key]]))
  return createHash('sha256').update(stableJson(payload)).digest('hex')
}

function rebindConfigurationHash(input: JsonObject): void {
  const hash = computeManifestConfigurationHash(input.manifest)
  input.manifest.configuration_hash = hash
  input.manifest.configuration_hash_contract.expected_hash = hash
  input.state.release_evidence.configuration.expected_hash = hash
  input.state.release_evidence.configuration.actual_hash = hash
  input.state.release_evidence.rehearsal.configuration_hash = hash
  input.state.release_evidence.owner_approval.configuration_hash = hash
}

function applyConfigurationDeltaReview(input: JsonObject, oldConfigurationHash?: string): void {
  const projection = input.sourceInventory.pr08_configuration_delta_contract
  oldConfigurationHash ??= projection.old_configuration_hash
  for (const taskId of REBOUND_TASKS) {
    const reviewReference = input.state.proofs[taskId].review.receipt
    const originalReview = JSON.parse(input.artifacts[reviewReference.path].content)
    originalReview.configuration_hash = oldConfigurationHash
    replaceArtifactContent(input, reviewReference, JSON.stringify(originalReview))
  }
  const receipt = {
    id: 'PR-08-CONFIGURATION-DELTA-v1',
    task_id: 'PR-08',
    verdict: 'PASS',
    reviewer: 'independent-configuration-delta-reviewer',
    independent: true,
    commit: input.state.commit,
    projection_id: projection.id,
    projection_receipt: addArtifact(input, 'proof/PR-08/configuration-delta-projection.json', JSON.stringify(projection)),
    base_commit: projection.base_commit,
    old_configuration_hash: oldConfigurationHash,
    new_configuration_hash: input.manifest.configuration_hash,
    old_projection_sha256: projection.old_projection_sha256,
    new_projection_sha256: projection.new_projection_sha256,
    changes_sha256: projection.changes_sha256,
    affected_tasks: REBOUND_TASKS,
    rebound_tasks: REBOUND_TASKS,
    changed_covered_fields: projection.changed_covered_fields,
    prior_acceptance_semantics_unchanged: true,
    hg04_stays_frozen: true,
  }
  const reference = addArtifact(input, 'proof/PR-08/configuration-delta-review.json', JSON.stringify(receipt))
  for (const taskId of REBOUND_TASKS) input.state.proofs[taskId].configuration_delta_review = { ...receipt, receipt: reference }
}

function materializeArtifacts(input: JsonObject) {
  const directory = mkdtempSync(join(tmpdir(), 'posture-readiness-'))
  const proofRoot = join(directory, 'proof')
  for (const [path, artifact] of Object.entries(input.artifacts) as Array<[string, JsonObject]>) {
    const file = join(directory, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, artifact.content)
  }
  input.state.proof_dir = proofRoot
  const statePath = join(directory, 'state.json')
  const manifestPath = join(directory, 'manifest.json')
  writeFileSync(statePath, JSON.stringify(input.state))
  writeFileSync(manifestPath, JSON.stringify(input.manifest))
  return { statePath, manifestPath }
}

describe('production readiness goal checker', () => {
  it('accepts a complete autonomous build receipt', () => {
    expect(validate('build', validInput())).toEqual({ autonomous_build_complete: true, launch_authorized: false, errors: [] })
  })

  it('accepts a complete launch receipt', () => {
    expect(validate('launch', validInput())).toEqual({ autonomous_build_complete: true, launch_authorized: true, errors: [] })
  })

  it('accepts frozen human/provider work for build but blocks launch', () => {
    const input = validInput({ freezeHuman: true })
    expect(validate('build', input).autonomous_build_complete).toBe(true)
    expect(validate('launch', input)).toMatchObject({ autonomous_build_complete: true, launch_authorized: false })
    expect(validate('launch', input).errors.some((error: string) => error.startsWith('HG_OPEN:'))).toBe(true)
  })

  it.each(FAILURE_CASES)('fails closed for $name', fixture => {
    const input = validInput()
    for (const patch of fixture.patches) applyPatch(input, patch)
    const result = validate(fixture.mode, input)
    expect(result.errors, JSON.stringify(result, null, 2)).toContainEqual(expect.stringMatching(new RegExp(`^${fixture.expected_error}:`)))
    expect(fixture.mode === 'build' ? result.autonomous_build_complete : result.launch_authorized).toBe(false)
  })

  it('recomputes the checked-in manifest configuration hash from canonical covered fields', () => {
    expect(computeManifestConfigurationHash(MANIFEST)).toBe(MANIFEST.configuration_hash)
    expect(validateManifestContract(MANIFEST, SOURCE_INVENTORY)).toEqual([])
  })

  it('rejects copied hashes after a covered field changes', () => {
    const input = validInput()
    input.manifest.release_boundary.milestone = 'different beta'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^CONFIG_HASH_RECOMPUTE:/))
  })

  it('rejects a proof path that escapes the canonical proof root', () => {
    const input = validInput()
    const task = input.state.tasks[0]
    task.proof_manifest = 'proof/../outside.json'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^ARTIFACT_PATH:/))
  })

  it('rejects an absolute proof path', () => {
    const input = validInput()
    input.state.tasks[0].proof_manifest = '/tmp/copied-proof.json'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^ARTIFACT_PATH:/))
  })

  it('rejects proof artifacts reported as symlinks', () => {
    const input = validInput()
    const path = input.state.tasks[0].proof_manifest
    input.artifacts[path].is_symlink = true
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^ARTIFACT_FILE:/))
  })

  it('recomputes receipt hashes from file content', () => {
    const input = validInput()
    const path = input.state.tasks[0].proof_manifest
    input.artifacts[path].content = 'tampered after receipt issuance'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^ARTIFACT_HASH:/))
  })

  it('requires approved E2E skips to match key, source, and scope', () => {
    const accepted = validInput()
    const skip = accepted.manifest.e2e.approved_skips[0]
    const acceptedObserved = { key: skip.key, source: skip.source, scope: clone(skip.scope) }
    const acceptedReportRef = accepted.state.release_evidence.e2e.report_receipt
    const acceptedReport = JSON.parse(accepted.artifacts[acceptedReportRef.path].content)
    const acceptedTest = acceptedReport.tests.find((test: JsonObject) => `${test.project}::${test.file}::${test.title}` === skip.test_ids[0])
    acceptedTest.annotations = [{ type: 'production-readiness-skip', description: JSON.stringify(acceptedObserved) }]
    acceptedTest.results = [{ retry: 0, status: 'skipped' }]
    acceptedReport.observed_skips = [acceptedObserved]
    accepted.state.release_evidence.e2e.observed_skips = [acceptedObserved]
    replaceArtifactContent(accepted, acceptedReportRef, JSON.stringify(acceptedReport))
    expect(validate('launch', accepted).launch_authorized).toBe(true)

    const mismatched = validInput()
    const mismatchedObserved = { key: skip.key, source: `${skip.source} altered`, scope: clone(skip.scope) }
    const mismatchedReportRef = mismatched.state.release_evidence.e2e.report_receipt
    const mismatchedReport = JSON.parse(mismatched.artifacts[mismatchedReportRef.path].content)
    const mismatchedTest = mismatchedReport.tests.find((test: JsonObject) => `${test.project}::${test.file}::${test.title}` === skip.test_ids[0])
    mismatchedTest.annotations = [{ type: 'production-readiness-skip', description: JSON.stringify(mismatchedObserved) }]
    mismatchedTest.results = [{ retry: 0, status: 'skipped' }]
    mismatchedReport.observed_skips = [mismatchedObserved]
    mismatched.state.release_evidence.e2e.observed_skips = [mismatchedObserved]
    replaceArtifactContent(mismatched, mismatchedReportRef, JSON.stringify(mismatchedReport))
    expect(validate('launch', mismatched).errors).toContainEqual(expect.stringMatching(/^E2E_SKIP:/))
  })

  it('rejects an approved skip contract that omits exact test IDs', () => {
    const input = validInput()
    delete input.manifest.e2e.approved_skips[0].test_ids
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^E2E_SKIP_CONTRACT:/))
  })

  it('rejects a skip test ID moved to a different project or file', () => {
    const input = validInput()
    input.manifest.e2e.approved_skips[0].test_ids[0] = 'desktop-chromium::e2e/unrelated.spec.ts::borrowed title'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^E2E_SKIP_CONTRACT:/))
  })

  it('rejects duplicate canonical Axe target keys', () => {
    const input = validInput()
    input.manifest.e2e.axe_receipts.targets.push(clone(input.manifest.e2e.axe_receipts.targets[0]))
    input.manifest.e2e.axe_receipts.expected_total += 1
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^E2E_AXE_CONTRACT:/))
  })

  it('rejects reuse of an approved skip annotation on another test title', () => {
    const input = validInput()
    const skip = input.manifest.e2e.approved_skips[0]
    const annotation = { key: skip.key, source: skip.source, scope: clone(skip.scope) }
    mutateExecutedPlaywrightReport(input, report => {
      const test = report.tests.find((row: JsonObject) => row.project === skip.scope.project && !skip.test_ids.includes(`${row.project}::${row.file}::${row.title}`))
      test.annotations = [{ type: 'production-readiness-skip', description: JSON.stringify(annotation) }]
      test.results = [{ retry: 0, status: 'skipped' }]
      report.observed_skips = [annotation]
    })
    input.state.release_evidence.e2e.observed_skips = [annotation]
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_REPORT_BINDING:/))
  })

  it('rejects duplicate production-readiness annotations on one skipped test', () => {
    const input = validInput()
    const skip = input.manifest.e2e.approved_skips[0]
    const annotation = { key: skip.key, source: skip.source, scope: clone(skip.scope) }
    mutateExecutedPlaywrightReport(input, report => {
      const test = report.tests.find((row: JsonObject) => `${row.project}::${row.file}::${row.title}` === skip.test_ids[0])
      test.annotations = [
        { type: 'production-readiness-skip', description: JSON.stringify(annotation) },
        { type: 'production-readiness-skip', description: JSON.stringify(annotation) },
      ]
      test.results = [{ retry: 0, status: 'skipped' }]
      report.observed_skips = [annotation]
    })
    input.state.release_evidence.e2e.observed_skips = [annotation]
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_REPORT_BINDING:/))
  })

  it('binds E2E evidence to the hashed Playwright JSON/list inventory', () => {
    const input = validInput()
    const reference = input.state.release_evidence.e2e.inventory_receipt
    const receipt = JSON.parse(input.artifacts[reference.path].content)
    receipt.expected_total += 1
    replaceArtifactContent(input, reference, JSON.stringify(receipt))
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_INVENTORY_RECEIPT:/))
  })

  it('requires test-only variables to be absent from the distinct HG-09 rehearsal', () => {
    const input = validInput()
    input.state.release_evidence.rehearsal.environment_variables.NEXT_PUBLIC_POSTURE_TEST_MODE = false
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^REHEARSAL_TEST_FLAG:/))
  })

  it('accepts launch configuration with required-absent test variables omitted', () => {
    const input = validInput()
    expect(Object.hasOwn(input.state.release_evidence.configuration.environment_variables, 'POSTURE_TEST_MODE_ENABLED')).toBe(false)
    expect(Object.hasOwn(input.state.release_evidence.configuration.environment_variables, 'NEXT_PUBLIC_POSTURE_TEST_MODE')).toBe(false)
    expect(validate('launch', input).launch_authorized).toBe(true)
  })

  it.each(['POSTURE_TEST_MODE_ENABLED', 'NEXT_PUBLIC_POSTURE_TEST_MODE'])('rejects required-absent %s even when explicitly false', key => {
    const input = validInput()
    input.state.release_evidence.configuration.environment_variables[key] = false
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^TEST_FLAG_PRESENCE:/))
  })

  it('requires absent-or-false assertions to use the boolean false value', () => {
    const input = validInput()
    input.state.release_evidence.configuration.environment_variables.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = 'false'
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^TEST_FLAG_ASSERTION:/))
  })

  it('rejects a redirected independently pinned source contract', () => {
    const input = validInput()
    input.manifest.source_contracts[0].path = 'docs/qa/redirected-audit.md'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_CONTRACT:/))
  })

  it('rejects a missing source contract or source identity contract', () => {
    const missingSource = validInput()
    missingSource.manifest.source_contracts.pop()
    expect(validate('build', missingSource).errors).toContainEqual(expect.stringMatching(/^SOURCE_CONTRACT:/))

    const missingIdentity = validInput()
    delete missingIdentity.manifest.source_identity_contract
    expect(validate('build', missingIdentity).errors).toContainEqual(expect.stringMatching(/^SOURCE_CONTRACT:/))
  })

  it('recomputes actual source content and rejects stale pinned files', () => {
    const input = validInput()
    input.actualSources.files[0].content += '\ncoordinated drift\n'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_DRIFT:/))
  })

  it('rejects validator state redirected away from the canonical goal-state file', () => {
    const input = validInput()
    input.actualSources.validation_state.requested_path = '/tmp/copied-state.json'
    input.actualSources.validation_state.resolved_path = '/tmp/copied-state.json'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^STATE_SOURCE_IDENTITY:/))
  })

  it('requires an exact frozen-gate owner, dependency list, and acceptance contract', () => {
    const input = validInput({ freezeHuman: true })
    input.state.frozen[0].owner = 'arbitrary volunteer'
    input.state.frozen[0].dependencies = ['not-a-real-dependency']
    input.state.frozen[0].acceptance_criteria = 'looks fine'
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^FROZEN_CONTRACT:/))
  })

  it('rejects missing, duplicate, or extra frozen-ledger rows', () => {
    const input = validInput({ freezeHuman: true })
    input.state.frozen.push(clone(input.state.frozen[0]))
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^FROZEN_LEDGER:/))
  })

  it('requires every non-PR17 proof to bind commit and changed-file receipts', () => {
    const input = validInput()
    delete input.state.proofs['PR-00'].commit
    delete input.state.proofs['PR-00'].commit_receipt
    delete input.state.proofs['PR-00'].changed_files_receipt
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_COMMIT:/))
  })

  it('accepts an independent PR-08 configuration-delta review without copying old PASS receipts forward', () => {
    const input = validInput()
    applyConfigurationDeltaReview(input)

    expect(validate('build', input).errors.filter((error: string) => error.startsWith('PROOF_REVIEW_RECEIPT:') || error.startsWith('PROOF_CONFIGURATION_DELTA:'))).toEqual([])
  })

  it('rejects a stale PR-00 review when the PR-08 configuration-delta receipt is missing', () => {
    const input = validInput()
    const reference = input.state.proofs['PR-00'].review.receipt
    const receipt = JSON.parse(input.artifacts[reference.path].content)
    receipt.configuration_hash = 'a'.repeat(64)
    replaceArtifactContent(input, reference, JSON.stringify(receipt))

    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_CONFIGURATION_DELTA:/))
  })

  it.each([
    ['summary mismatch', (receipt: JsonObject) => { receipt.verdict = 'FAIL' }],
    ['wrong affected tasks', (receipt: JsonObject) => { receipt.affected_tasks = REBOUND_TASKS.slice(0, -1) }],
    ['omitted covered change', (receipt: JsonObject) => { receipt.changed_covered_fields = receipt.changed_covered_fields.slice(1) }],
    ['extra covered change', (receipt: JsonObject) => { receipt.changed_covered_fields = [...receipt.changed_covered_fields, 'release_boundary'] }],
    ['tampered new projection hash', (receipt: JsonObject) => { receipt.new_projection_sha256 = 'f'.repeat(64) }],
    ['copied original reviewer', (receipt: JsonObject) => { receipt.reviewer = 'independent-reviewer' }],
    ['wrong original configuration hash', (receipt: JsonObject) => { receipt.old_configuration_hash = 'b'.repeat(64) }],
  ])('rejects a configuration-delta review with %s', (_name, mutate) => {
    const input = validInput()
    applyConfigurationDeltaReview(input)
    const reference = input.state.proofs['PR-00'].configuration_delta_review.receipt
    const receipt = JSON.parse(input.artifacts[reference.path].content)
    mutate(receipt)
    replaceArtifactContent(input, reference, JSON.stringify(receipt))
    if (_name !== 'summary mismatch') {
      for (const taskId of REBOUND_TASKS) input.state.proofs[taskId].configuration_delta_review = { ...receipt, receipt: reference }
    }

    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_CONFIGURATION_DELTA:/))
  })

  it('rejects a configuration-delta review whose bound projection artifact is value-tampered', () => {
    const input = validInput()
    applyConfigurationDeltaReview(input)
    const deltaReference = input.state.proofs['PR-00'].configuration_delta_review.receipt
    const delta = JSON.parse(input.artifacts[deltaReference.path].content)
    const projection = JSON.parse(input.artifacts[delta.projection_receipt.path].content)
    projection.changes[0].new_value = 'tampered'
    replaceArtifactContent(input, delta.projection_receipt, JSON.stringify(projection))
    replaceArtifactContent(input, deltaReference, JSON.stringify(delta))
    for (const taskId of REBOUND_TASKS) input.state.proofs[taskId].configuration_delta_review = { ...delta, receipt: deltaReference }

    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_CONFIGURATION_DELTA:/))
  })

  it('accepts completed tasks on distinct real commits reachable from the release HEAD', () => {
    const input = validInput()
    setTaskCommit(input, 'PR-00', ANCESTOR_COMMIT)
    expect(input.state.tasks.find((row: JsonObject) => row.id === 'PR-00').commit).not.toBe(input.state.tasks.find((row: JsonObject) => row.id === 'PR-01').commit)
    expect(validate('build', input)).toEqual({ autonomous_build_complete: true, launch_authorized: false, errors: [] })
  })

  it('rejects a completed task proof bound to a nonexistent commit', () => {
    const input = validInput()
    setTaskCommit(input, 'PR-00', 'f'.repeat(40))
    const live = input.liveRepository.task_commits.find((row: JsonObject) => row.task_id === 'PR-00')
    live.exists = false
    live.reachable_from_head = false
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^LIVE_TASK_COMMIT:/))
  })

  it('rejects a real completed-task commit that is unreachable from the release HEAD', () => {
    const input = validInput()
    const live = input.liveRepository.task_commits.find((row: JsonObject) => row.task_id === 'PR-00')
    live.reachable_from_head = false
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^LIVE_TASK_COMMIT:/))
  })

  it('rejects a proof change set that does not match its state task ledger', () => {
    const input = validInput()
    const proof = input.state.proofs['PR-00']
    proof.changed_files = ['app/fake.ts']
    proof.allowed_changed_files = ['app/fake.ts']
    replaceArtifactContent(input, proof.changed_files_receipt, JSON.stringify({ task_id: 'PR-00', commit: proof.commit, changed_files: proof.changed_files, allowed_changed_files: proof.allowed_changed_files }))
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_STATE_BINDING:/))
  })

  it('rejects a coordinated reduction of the manifest PR17 command contract', () => {
    const input = validInput()
    input.manifest.ci_contract.global_commands = ['true']
    input.manifest.ci_contract.pr17_additional_commands = []
    input.state.proofs['PR-17'].commands = [{ command: 'true', exit_code: 0, receipt: input.state.proofs['PR-17'].commands[0].receipt }]
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_PR17_COMMANDS:/))
  })

  it('rejects an arbitrary HG09 command even when its self-attested receipt passes', () => {
    const input = validInput()
    input.state.release_evidence.rehearsal.command = 'true'
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^REHEARSAL_COMMAND:/))
  })

  it('requires verified human and provider receipts', () => {
    const input = validInput()
    input.state.proofs['HG-00'].receipt.verified = false
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^HG_RECEIPT:/))
  })

  it('rejects the generic verified receipt bypass for HG-04', () => {
    const input = validInput({ includeHg04Evidence: false })

    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^HG04_DEVICE_EVIDENCE:/))
  })

  it('rejects fixture, sufficient-by-itself, unsigned, self-reviewed, stale, unapproved, or non-human HG-04 evidence', () => {
    const cases: Array<[string, (input: JsonObject) => void]> = [
      ['fixture validation', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.validator_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.mode = 'fixture'; content.fixture = true; content.test_mode = true; content.physical_packet_valid = false
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['validator claiming launch authority', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.validator_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.hg04_launch_eligible = true
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['validator source hash mismatch', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.validator_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.validator_sha256 = 'f'.repeat(64)
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['schema source hash mismatch', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.validator_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.schema_sha256 = 'f'.repeat(64)
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['validator reviewer authority mismatch', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.validator_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.approved_reviewer_public_key_fingerprints = ['f'.repeat(64)]
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['unsigned review', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.independent_review_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.signature.value_base64 = ''
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['operator reviewing own packet', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.independent_review_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.receipt.reviewer_id = content.receipt.operator_id
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['blank review id with a valid signature', input => {
        mutateSignedHg04Review(input, receipt => { receipt.review_id = '   ' })
      }],
      ['blank reviewer id with a valid signature', input => {
        mutateSignedHg04Review(input, receipt => { receipt.reviewer_id = '   ' })
      }],
      ['incomplete deterministic sample set with a valid signature', input => {
        mutateSignedHg04Review(input, receipt => { receipt.sampled_remaining_row_keys = receipt.sampled_remaining_row_keys.slice(1) })
      }],
      ['review before collection completion with a valid signature', input => {
        mutateSignedHg04Review(input, receipt => { receipt.reviewed_at = '2026-07-19T23:00:00.000Z' })
      }],
      ['review in the future with a valid signature', input => {
        mutateSignedHg04Review(input, receipt => { receipt.reviewed_at = '2026-07-19T23:31:00.000Z' })
      }],
      ['stale review packet binding', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.independent_review_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.receipt.packet_sha256 = 'f'.repeat(64)
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['unapproved reviewer key', input => {
        input.state.release_evidence.configuration.hg04_approved_reviewer_public_key_fingerprints = []
        const reference = input.state.release_evidence.configuration.receipt
        replaceArtifactContent(input, reference, JSON.stringify({ commit: input.state.commit, configuration_hash: input.manifest.configuration_hash, hg04_approved_reviewer_public_key_fingerprints: [] }))
      }],
      ['missing human-owned transition', input => {
        const reference = input.state.proofs['HG-04'].device_evidence.human_transition_receipt
        const content = JSON.parse(input.artifacts[reference.path].content)
        content.human_owned = false
        replaceArtifactContent(input, reference, JSON.stringify(content))
      }],
      ['transition not strictly after review', input => {
        const transitionReference = input.state.proofs['HG-04'].device_evidence.human_transition_receipt
        const transition = JSON.parse(input.artifacts[transitionReference.path].content)
        transition.transitioned_at = '2026-07-19T23:10:00.000Z'
        replaceArtifactContent(input, transitionReference, JSON.stringify(transition))
      }],
    ]
    for (const [, mutate] of cases) {
      const input = validInput()
      mutate(input)
      expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^HG04_DEVICE_EVIDENCE:/))
    }
  })

  it('rejects internally consistent HG-04 evidence bound to a non-canonical device contract', () => {
    const input = validInput()
    const proof = input.state.proofs['HG-04'].device_evidence
    const validation = JSON.parse(input.artifacts[proof.validator_receipt.path].content)
    validation.contract_sha256 = 'f'.repeat(64)
    replaceArtifactContent(input, proof.validator_receipt, JSON.stringify(validation))
    const reviewPacket = JSON.parse(input.artifacts[proof.independent_review_receipt.path].content)
    reviewPacket.receipt.contract_sha256 = validation.contract_sha256
    reviewPacket.signature.value_base64 = sign(null, Buffer.from(stableJson(reviewPacket.receipt)), HG04_REVIEW_KEY.privateKey).toString('base64')
    replaceArtifactContent(input, proof.independent_review_receipt, JSON.stringify(reviewPacket))

    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^HG04_DEVICE_EVIDENCE:/))
  })

  it('rejects council receipts bound to a stale commit and configuration', () => {
    const input = validInput()
    input.state.release_evidence.council[0].commit = 'ffffffffffffffffffffffffffffffffffffffff'
    input.state.release_evidence.council[0].configuration_hash = 'f'.repeat(64)
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^COUNCIL_BINDING:/))
  })

  it('rejects a coordinated applicability edit that waives PR03', () => {
    const input = validInput()
    const manifestTask = input.manifest.tasks.find((task: JsonObject) => task.id === 'PR-03')
    manifestTask.applicability = { default_state: 'not_applicable', expression: { any_true: [{ var: 'release_boundary.native_release_enabled' }] } }
    const task = input.state.tasks.find((row: JsonObject) => row.id === 'PR-03')
    task.applicability = 'not_applicable'
    task.outcome = 'not_applicable'
    const criterion = input.manifest.criteria.find((row: JsonObject) => row.task_id === 'PR-03')
    criterion.outcome = 'not_applicable'
    rebindConfigurationHash(input)
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_TASK_APPLICABILITY:/))
  })

  it('rejects a coordinated downgrade of the PRD-001 audit contract', () => {
    const input = validInput()
    input.manifest.audit_findings[0].severity = 'S4'
    rebindConfigurationHash(input)
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_AUDIT_CONTRACT:/))
  })

  it('rejects coordinated removal of an audit row dependency mapping', () => {
    const input = validInput()
    input.manifest.audit_findings[0].dependencies = []
    rebindConfigurationHash(input)
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_AUDIT_DEPENDENCIES:/))
  })

  it('rejects a coordinated fake E2E manifest and receipt that disagree with the live Playwright list', () => {
    const input = validInput()
    input.manifest.e2e.projects = { setup: 1, 'desktop-chromium': 1, 'mobile-webkit': 54, calibration: 1 }
    input.manifest.e2e.expected_total = 57
    input.manifest.e2e.inventory_hash = coordinatedE2eHash(input.manifest.e2e)
    input.state.release_evidence.e2e.projects = clone(input.manifest.e2e.projects)
    input.state.release_evidence.e2e.inventory_hash = input.manifest.e2e.inventory_hash
    const reference = input.state.release_evidence.e2e.inventory_receipt
    replaceArtifactContent(input, reference, artifactContent(reference.path, input.manifest))
    rebindConfigurationHash(input)
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_SOURCE_DRIFT:/))
  })

  it('rejects a nonexistent release commit despite coordinated clean-tree self-attestation', () => {
    const input = validInput()
    const fake = 'f'.repeat(40)
    input.state.commit = fake
    input.state.release_evidence.repository.head_sha = fake
    input.state.release_evidence.repository.expected_sha = fake
    input.state.release_evidence.ci.commit = fake
    input.state.release_evidence.rehearsal.commit = fake
    input.state.release_evidence.owner_approval.commit = fake
    input.state.proofs['PR-17'].commit = fake
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^LIVE_COMMIT:/))
  })

  it('rejects a generic owner approval file not bound to the complete final packet', () => {
    const input = validInput()
    replaceArtifactContent(input, input.state.release_evidence.owner_approval.receipt, 'generic unrelated owner approval')
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^OWNER_APPROVAL_RECEIPT:/))
  })

  it('rejects owner approval issued before HG-09 and its final council completed', () => {
    const input = validInput()
    setOwnerApprovalTimestamp(input, '2026-07-19T22:59:59.999Z')
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^OWNER_APPROVAL_CHRONOLOGY:/))
  })

  it('accepts owner approval at the exact HG-09 completion boundary', () => {
    const input = validInput()
    setOwnerApprovalTimestamp(input, input.state.release_evidence.rehearsal.completed_at)
    expect(validate('launch', input).launch_authorized).toBe(true)
  })

  it('rejects an invalid owner approval timestamp', () => {
    const input = validInput()
    setOwnerApprovalTimestamp(input, 'not-a-timestamp')
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^OWNER_APPROVAL_CHRONOLOGY:/))
  })

  it('rejects an owner approval timestamp in the future', () => {
    const input = validInput()
    setOwnerApprovalTimestamp(input, '2026-07-20T00:00:00.000Z')
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^OWNER_APPROVAL_CHRONOLOGY:/))
  })

  it('rejects mutable CI freshness even when the manifest self-attests a larger window', () => {
    const input = validInput()
    input.manifest.ci_contract.max_age_hours = 876_000
    input.manifest.ci_contract.maximum_ci_age_hours = 876_000
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_CI_CONTRACT:/))
  })

  it('rejects a coordinated extension of the independently pinned HG-09 freshness window', () => {
    const input = validInput()
    input.manifest.intended_beta_rehearsal_contract.freshness_hours = 876_000
    rebindConfigurationHash(input)
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^SOURCE_HG09_CONTRACT:/))
  })

  it('rejects omission of a skip present in the executed Playwright JSON report', () => {
    const input = validInput()
    const report = executedPlaywrightReport(input)
    const skip = input.manifest.e2e.approved_skips[0]
    const test = report.tests[0]
    test.annotations = [{ type: 'production-readiness-skip', description: JSON.stringify({ key: skip.key, source: skip.source, scope: skip.scope }) }]
    test.results = [{ retry: 0, status: 'skipped' }]
    input.state.release_evidence.e2e.report_receipt = addArtifact(input, 'proof/PR-17/playwright-report.json', JSON.stringify(report))
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_REPORT_BINDING:/))
  })

  it('rejects omission of a retry and flake present in the executed Playwright JSON report', () => {
    const input = validInput()
    const report = executedPlaywrightReport(input)
    const test = report.tests[1]
    test.results = [{ retry: 0, status: 'failed' }, { retry: 1, status: 'passed' }]
    input.state.release_evidence.e2e.report_receipt = addArtifact(input, 'proof/PR-17/playwright-report.json', JSON.stringify(report))
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_REPORT_BINDING:/))
  })

  it.each([
    ['skip_validation_failures', [{ reason_code: 'skip_annotation_missing' }]],
    ['a11y_receipt_failures', [{ reason_code: 'axe_receipt_missing' }]],
  ])('rejects a nonempty %s array even when the report claims success', (field, value) => {
    const input = validInput()
    mutateExecutedPlaywrightReport(input, report => { report[field] = value })
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_AXE_REPORT_BINDING:/))
  })

  it.each(['skip_validation_failures', 'a11y_receipt_failures', 'axe_receipt_validation'])(
    'rejects omission of required Playwright report field %s',
    field => {
      const input = validInput()
      mutateExecutedPlaywrightReport(input, report => { delete report[field] })
      expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_REPORT_BINDING:/))
    },
  )

  it.each([
    ['manifest_expected_total', 72],
    ['expected_run_total', 72],
    ['materialized_total', 72],
    ['status', 'failed'],
  ])('rejects Axe validation tampering of %s', (field, value) => {
    const input = validInput()
    mutateExecutedPlaywrightReport(input, report => { report.axe_receipt_validation[field] = value })
    expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_AXE_REPORT_BINDING:/))
  })

  it.each(['expected_run_targets', 'materialized_targets'])(
    'rejects omission or substitution in the exact Axe %s set',
    field => {
      const input = validInput()
      mutateExecutedPlaywrightReport(input, report => {
        report.axe_receipt_validation[field] = report.axe_receipt_validation[field].slice(1)
      })
      expect(validate('launch', input).errors).toContainEqual(expect.stringMatching(/^E2E_AXE_REPORT_BINDING:/))
    },
  )

  it('rejects an unrelated generic independent-review receipt', () => {
    const input = validInput()
    replaceArtifactContent(input, input.state.proofs['PR-01'].review.receipt, 'generic unrelated review')
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^PROOF_REVIEW_RECEIPT:/))
  })

  it('requires an applicability reason on every state task', () => {
    const input = validInput()
    delete input.state.tasks[0].applicability_reason
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^TASK_APPLICABILITY_REASON:/))
  })

  it('detects applicability omissions in the canonical state-file binding', () => {
    const input = validInput()
    const staleState = clone(input.state)
    delete staleState.tasks[0].applicability
    input.actualSources.validation_state.content = JSON.stringify(staleState)
    expect(runReadinessValidator({ mode: 'build', ...input }).errors).toContainEqual(expect.stringMatching(/^STATE_SOURCE_DRIFT:/))
  })

  it('accepts PR-11 completed not_applicable only with the sanctioned no-eligible-profile proof', () => {
    const input = validInput()
    applyPr11NotApplicable(input)
    expect(validate('build', input)).toEqual({ autonomous_build_complete: true, launch_authorized: false, errors: [] })
  })

  it('rejects generic or fail-open PR-11 not_applicable evidence', () => {
    const generic = validInput()
    const genericTask = generic.state.tasks.find((row: JsonObject) => row.id === 'PR-11')
    genericTask.outcome = 'not_applicable'
    expect(validate('build', generic).errors).toContainEqual(expect.stringMatching(/^TASK_NA_PROOF:/))

    const failOpen = validInput()
    applyPr11NotApplicable(failOpen, { consumerActive: true, includeExclusionEvidence: false })
    expect(validate('build', failOpen).errors).toContainEqual(expect.stringMatching(/^TASK_NA_PROOF:/))
  })

  it('binds the independent source inventory to the audit and durable goal state', () => {
    const audit = readFileSync(join(ROOT, 'docs/qa/AUDIT.md'), 'utf8')
    const auditIds = [...audit.matchAll(/^\| ((?:PRD|CAP|REL|CLN|LEG|AUTH|SEC|OPS|SCL)-\d{3}) \|/gm)].map(match => match[1])
    const state = JSON.parse(readFileSync('/Users/zero-suminc./.claude/goal-state/posture-ai-production-readiness/state.json', 'utf8'))
    expect([...new Set(auditIds)].sort()).toEqual([...SOURCE_INVENTORY.audit_row_ids].sort())
    expect(state.tasks.map(({ id, kind, dependencies, maps_to_criterion }: JsonObject) => ({ id, kind, dependencies, maps_to_criterion }))).toEqual(SOURCE_INVENTORY.tasks.map(({ id, kind, dependencies, maps_to_criterion }: JsonObject) => ({ id, kind, dependencies, maps_to_criterion })))
    expect(state.tasks.map(({ id, applicability, applicability_reason }: JsonObject) => ({ id, applicability, applicability_reason }))).toEqual(SOURCE_INVENTORY.state_task_contracts)
    expect(MANIFEST.tasks.map(({ id, applicability }: JsonObject) => ({ id, applicability }))).toEqual(SOURCE_INVENTORY.tasks.map(({ id, applicability }: JsonObject) => ({ id, applicability })))
    expect(computeSourceInventoryHash(SOURCE_INVENTORY)).toBe(SOURCE_INVENTORY.inventory_hash)
  })

  it('does not accept release evidence copied into the checked-in manifest', () => {
    const input = validInput()
    input.manifest.release_evidence = input.state.release_evidence
    delete input.state.release_evidence
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^RELEASE_EVIDENCE:/))
  })

  it('requires completed HG-03 proof before enabling any clinical content', () => {
    const input = validInput()
    input.manifest.release_boundary.clinical_approval_present = true
    input.manifest.release_boundary.assessment_only = false
    input.manifest.release_boundary.programs_enabled = true
    const hg03 = input.state.tasks.find((task: JsonObject) => task.id === 'HG-03')
    hg03.status = 'frozen'
    hg03.outcome = null
    delete input.state.proofs['HG-03']
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^BOUNDARY_HG03:/))
  })

  it('fails a dependent that enters progress before its prerequisite passes', () => {
    const input = validInput()
    const pr00 = input.state.tasks.find((task: JsonObject) => task.id === 'PR-00')
    const pr01 = input.state.tasks.find((task: JsonObject) => task.id === 'PR-01')
    pr00.status = 'pending'
    pr00.outcome = null
    pr01.status = 'in_progress'
    pr01.outcome = null
    expect(validate('build', input).errors).toContainEqual(expect.stringMatching(/^DEPENDENCY_UNMET:/))
  })

  it('CLI recomputes live git state and rejects a nonexistent supplied release commit', () => {
    const input = validInput()
    input.manifest.ci_contract.max_age_hours = 876_000
    input.manifest.configuration_hash_contract.maximum_rehearsal_age_hours = 876_000
    input.state.commit = 'f'.repeat(40)
    const paths = materializeArtifacts(input)
    const result = spawnSync(process.execPath, [CHECKER, '--launch', '--state', paths.statePath, '--manifest', paths.manifestPath], { cwd: ROOT, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).errors).toContainEqual(expect.stringMatching(/^LIVE_COMMIT:/))
  }, 20_000)
})
