import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import receiptSanitizer from './playwright-receipt-sanitize.cjs'

const RESULT_STATUSES = new Set(['passed', 'skipped', 'failed', 'timedOut', 'interrupted'])
const { bindAxeReceipt, buildAxeReceipt, normalizeReceiptPath, sanitizeSelector, sanitizeText, stableJson, stableValue } = receiptSanitizer
export { buildAxeReceipt, normalizeReceiptPath, sanitizeSelector, stableJson }

const AXE_ATTACHMENT_SCHEMA = 'posture-ai-axe-scan-v1'

function cleanAnnotation(annotation) {
  return {
    type: sanitizeText(annotation?.type),
    description: sanitizeText(annotation?.description),
  }
}

function cleanResult(result) {
  const status = RESULT_STATUSES.has(result?.status) ? result.status : 'interrupted'
  return {
    status,
    retry: Number.isInteger(result?.retry) && result.retry >= 0 ? result.retry : 0,
  }
}

function orderedTests(tests, projectOrder) {
  const order = new Map(projectOrder.map((project, index) => [project, index]))
  return [...tests].sort((left, right) => {
    const projectDelta = (order.get(left.project) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.project) ?? Number.MAX_SAFE_INTEGER)
    if (projectDelta !== 0) return projectDelta
    const sequenceDelta = (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER)
    if (sequenceDelta !== 0) return sequenceDelta
    return `${left.file}\u0000${left.title}`.localeCompare(`${right.file}\u0000${right.title}`)
  })
}

function originatingTest(row) {
  return {
    project: row.project,
    file: row.file,
    title: row.title,
  }
}

function exactSkipProjection(value) {
  if (!value || typeof value !== 'object') return null
  if (Object.keys(value).sort().join('\u0000') !== ['key', 'scope', 'source'].join('\u0000')) return null
  if (typeof value.key !== 'string' || typeof value.source !== 'string' || !value.scope || typeof value.scope !== 'object' || Array.isArray(value.scope)) return null
  return { key: value.key, source: value.source, scope: stableValue(value.scope) }
}

function approvedSkipProjection(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.test_ids) || value.test_ids.length === 0 || value.test_ids.some(testId => typeof testId !== 'string' || testId.length === 0) || new Set(value.test_ids).size !== value.test_ids.length) return null
  const annotation = exactSkipProjection({ key: value.key, source: value.source, scope: value.scope })
  return annotation ? { annotation, test_ids: [...value.test_ids] } : null
}

function skipTestId(test) {
  return `${test.project}::${test.file}::${test.title}`
}

function validateSkips(tests, approvedSkips) {
  const approved = new Map((approvedSkips ?? []).map(approvedSkipProjection).filter(Boolean).map(value => [
    JSON.stringify(stableValue(value.annotation)),
    new Set(value.test_ids),
  ]))
  const observed = []
  const failures = []
  for (const test of tests) {
    if (test.results.at(-1)?.status !== 'skipped') continue
    const annotations = test.annotations.filter(value => value.type === 'production-readiness-skip')
    const origin = originatingTest(test)
    if (annotations.length === 0) {
      failures.push({ reason_code: 'skip_annotation_missing', originating_test: origin })
      continue
    }
    if (annotations.length !== 1) {
      failures.push({ reason_code: 'skip_annotation_malformed', originating_test: origin })
      continue
    }
    try {
      const parsed = exactSkipProjection(JSON.parse(annotations[0].description))
      if (!parsed) throw new Error('invalid skip annotation shape')
      if (
        !approved.has(JSON.stringify(stableValue(parsed)))
        || !approved.get(JSON.stringify(stableValue(parsed))).has(skipTestId(test))
        || parsed.scope.project !== test.project
        || !parsed.source.startsWith(`${test.file}::`)
      ) {
        failures.push({ reason_code: 'skip_annotation_unapproved', originating_test: origin })
        continue
      }
      observed.push(parsed)
    } catch {
      failures.push({ reason_code: 'skip_annotation_malformed', originating_test: origin })
    }
  }
  return { observed, failures }
}

function summarizeRetries(tests) {
  return tests.flatMap(test => {
    if (test.results.length <= 1 && !test.results.some(result => result.retry > 0)) return []
    const finalStatus = test.results.at(-1)?.status ?? 'interrupted'
    return [{
      test_id: `${test.project}::${test.file}::${test.title}`,
      status: finalStatus === 'passed' ? 'passed-on-retry' : `${finalStatus}-on-retry`,
      attempts: test.results.length,
    }]
  })
}

function cleanA11yReceiptFailure(failure) {
  return stableValue({
    reason_code: sanitizeText(failure.reason_code),
    ...(failure.attachment ? { attachment: sanitizeText(failure.attachment) } : {}),
    ...(failure.receipt_file ? { receipt_file: sanitizeText(failure.receipt_file) } : {}),
    ...(failure.target ? { target: cleanAxeTarget(failure.target) } : {}),
    originating_test: {
      project: sanitizeText(failure.originating_test.project),
      file: sanitizeText(failure.originating_test.file),
      title: sanitizeText(failure.originating_test.title),
    },
  })
}

function cleanValidationFailure(failure) {
  return stableValue({
    reason_code: sanitizeText(failure.reason_code),
    originating_test: {
      project: sanitizeText(failure.originating_test.project),
      file: sanitizeText(failure.originating_test.file),
      title: sanitizeText(failure.originating_test.title),
    },
  })
}

function orderedValidationFailures(failures) {
  return failures
    .map(cleanValidationFailure)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

function cleanAxeTarget(target) {
  return stableValue({
    project: sanitizeText(target.project),
    surface: sanitizeText(target.surface),
    path: normalizeReceiptPath(target.path),
    originating_test: {
      project: sanitizeText(target.originating_test.project),
      file: sanitizeText(target.originating_test.file),
      title: sanitizeText(target.originating_test.title),
    },
  })
}

function axeTargetKey(target) {
  return JSON.stringify(cleanAxeTarget(target))
}

function originatingTestKey(origin) {
  return JSON.stringify(stableValue({
    project: sanitizeText(origin.project),
    file: sanitizeText(origin.file),
    title: sanitizeText(origin.title),
  }))
}

function orderedA11yReceiptFailures(failures) {
  return failures
    .map(cleanA11yReceiptFailure)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

export function buildPlaywrightReceipt({
  metadata,
  startedAt,
  completedAt,
  status,
  tests,
  a11yReceiptFailures = [],
  axeReceiptValidation = undefined,
}) {
  const ordered = orderedTests(tests, metadata.project_order)
  const cleanFailures = orderedA11yReceiptFailures(a11yReceiptFailures)
  const executionComplete = ordered.length > 0 && ordered.every(test => {
    if (!Array.isArray(test.results) || test.results.length === 0) return false
    const finalStatus = cleanResult(test.results.at(-1)).status
    return finalStatus === 'passed' || finalStatus === 'skipped'
  })
  const cleanTests = ordered.map(test => ({
    project: sanitizeText(test.project),
    file: sanitizeText(test.file),
    title: sanitizeText(test.title),
    annotations: (test.annotations ?? []).map(cleanAnnotation),
    results: (test.results?.length ? test.results : [{ status: 'interrupted', retry: 0 }]).map(cleanResult),
  }))
  const skipValidation = validateSkips(cleanTests, metadata.approved_skips)
  const skipFailures = orderedValidationFailures(skipValidation.failures)
  const axeValidation = stableValue(axeReceiptValidation ?? {
    schema_version: metadata.axe_receipt_contract?.schema_version ?? 'posture-ai-axe-targets-v1',
    manifest_expected_total: metadata.axe_receipt_contract?.manifest_expected_total ?? (metadata.expected_axe_targets ?? []).length,
    expected_run_total: 0,
    materialized_total: 0,
    expected_run_targets: [],
    materialized_targets: [],
    status: cleanFailures.length === 0 ? 'passed' : 'failed',
  })
  return {
    format: 'playwright-json-report',
    command: metadata.command,
    commit: metadata.commit,
    configuration_hash: metadata.configuration_hash,
    inventory_id: metadata.inventory_id,
    inventory_hash: metadata.inventory_hash,
    project_order: [...metadata.project_order],
    projects: { ...metadata.projects },
    expected_total: metadata.expected_total,
    expected_files: metadata.expected_files,
    status: status === 'passed' && executionComplete && cleanFailures.length === 0 && skipFailures.length === 0 && axeValidation.status === 'passed' ? 'passed' : 'failed',
    started_at: startedAt,
    completed_at: completedAt,
    tests: cleanTests,
    observed_skips: skipValidation.observed,
    retry_results: summarizeRetries(cleanTests),
    skip_validation_failures: skipFailures,
    a11y_receipt_failures: cleanFailures,
    axe_receipt_validation: axeValidation,
  }
}

function isAxeAttachment(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.schema_version === AXE_ATTACHMENT_SCHEMA
    && typeof value.project === 'string'
    && typeof value.surface === 'string'
    && value.surface.length > 0
    && typeof value.path === 'string'
    && Array.isArray(value.violations)
    && value.violations.every(violation => (
      violation
      && typeof violation === 'object'
      && typeof violation.id === 'string'
      && (violation.impact === null || typeof violation.impact === 'string')
      && typeof violation.help === 'string'
      && Array.isArray(violation.targets)
      && violation.targets.every(target => Array.isArray(target) && target.every(part => typeof part === 'string'))
    )),
  )
}

function detectedCommand() {
  const testIndex = process.argv.lastIndexOf('test')
  const scopedArgs = testIndex >= 0 ? process.argv.slice(testIndex + 1) : []
  if (scopedArgs.length > 0) return 'scoped-playwright-run'
  return process.env.CI ? 'CI=1 npm run test:e2e' : 'npm run test:e2e'
}

function loadMetadata(rootDir) {
  const manifest = JSON.parse(readFileSync(resolve(rootDir, 'docs/qa/production-readiness-manifest.json'), 'utf8'))
  const commit = /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA ?? '')
    ? process.env.GITHUB_SHA
    : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim()
  const axeContract = manifest.e2e.axe_receipts
  const expectedAxeTargets = axeContract.projects.flatMap(project => axeContract.scans.map(scan => ({
    project,
    surface: scan.surface,
    path: scan.path,
    originating_test: {
      project,
      file: scan.originating_test.file,
      title: scan.originating_test.title,
    },
  }))).concat(axeContract.targets ?? [])
  if (axeContract.schema_version !== 'posture-ai-axe-targets-v1' || expectedAxeTargets.length !== axeContract.expected_total) {
    throw new Error('invalid Axe receipt target contract')
  }
  return {
    command: detectedCommand(),
    commit,
    configuration_hash: manifest.configuration_hash,
    inventory_id: manifest.e2e.inventory_id,
    inventory_hash: manifest.e2e.inventory_hash,
    project_order: manifest.e2e.project_order,
    projects: manifest.e2e.projects,
    expected_total: manifest.e2e.expected_total,
    expected_files: manifest.e2e.expected_files,
    approved_skips: manifest.e2e.approved_skips.map(skip => ({
      key: skip.key,
      source: skip.source,
      scope: stableValue(skip.scope),
      test_ids: [...skip.test_ids],
    })),
    axe_receipt_contract: {
      schema_version: axeContract.schema_version,
      manifest_expected_total: axeContract.expected_total,
    },
    expected_axe_targets: expectedAxeTargets,
  }
}

function validateAxeReceipts(metadata, tests, axeReceipts, initialFailures) {
  const expected = (metadata.expected_axe_targets ?? []).map(cleanAxeTarget)
  const passedOrigins = new Set(tests
    .filter(test => cleanResult(test.results.at(-1)).status === 'passed')
    .map(test => originatingTestKey(originatingTest(test))))
  const expectedRun = expected.filter(target => passedOrigins.has(originatingTestKey(target.originating_test)))
  const actual = [...axeReceipts.values()].map(receipt => cleanAxeTarget({
    project: receipt.project,
    surface: receipt.surface,
    path: receipt.path,
    originating_test: receipt.release_binding.originating_test,
  }))
  const expectedRunKeys = new Set(expectedRun.map(axeTargetKey))
  const actualKeys = new Set(actual.map(axeTargetKey))
  const failures = [...initialFailures]

  for (const test of tests) {
    if (cleanResult(test.results.at(-1)).status !== 'passed' || test.file !== 'e2e/a11y.spec.ts') continue
    const originKey = originatingTestKey(originatingTest(test))
    if (!expected.some(target => originatingTestKey(target.originating_test) === originKey)) {
      failures.push({
        reason_code: 'axe_test_contract_missing',
        originating_test: originatingTest(test),
      })
    }
  }

  for (const target of expectedRun) {
    if (actualKeys.has(axeTargetKey(target))) continue
    failures.push({
      reason_code: 'axe_receipt_missing',
      target,
      originating_test: target.originating_test,
    })
  }
  for (const target of actual) {
    if (expectedRunKeys.has(axeTargetKey(target))) continue
    failures.push({
      reason_code: 'axe_receipt_unexpected_target',
      target,
      originating_test: target.originating_test,
    })
  }

  return {
    failures,
    validation: {
      schema_version: metadata.axe_receipt_contract?.schema_version ?? 'posture-ai-axe-targets-v1',
      manifest_expected_total: metadata.axe_receipt_contract?.manifest_expected_total ?? expected.length,
      expected_run_total: expectedRun.length,
      materialized_total: actual.length,
      expected_run_targets: expectedRun.sort((left, right) => axeTargetKey(left).localeCompare(axeTargetKey(right))),
      materialized_targets: actual.sort((left, right) => axeTargetKey(left).localeCompare(axeTargetKey(right))),
      status: failures.length === 0 ? 'passed' : 'failed',
    },
  }
}

async function replaceA11yDirectory(targetDir, entries) {
  const parent = dirname(targetDir)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(resolve(parent, `.${basename(targetDir)}-next-`))
  for (const [file, receipt] of entries) {
    await writeFile(resolve(staging, file), stableJson(receipt), { encoding: 'utf8', mode: 0o600 })
  }

  const backup = resolve(parent, `.${basename(targetDir)}-previous-${process.pid}-${Date.now()}`)
  let movedExisting = false
  try {
    await rename(targetDir, backup)
    movedExisting = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await rename(staging, targetDir)
  } catch (error) {
    if (movedExisting) await rename(backup, targetDir)
    throw error
  }
  if (movedExisting) await rm(backup, { recursive: true, force: true })
}

export default class PlaywrightReceiptReporter {
  constructor(options = {}) {
    this.rootDir = options.rootDir ?? process.cwd()
    this.outputFile = isAbsolute(options.outputFile ?? '')
      ? options.outputFile
      : resolve(this.rootDir, options.outputFile ?? 'test-results/playwright-results.json')
    this.a11yOutputDir = isAbsolute(options.a11yOutputDir ?? '')
      ? options.a11yOutputDir
      : resolve(this.rootDir, options.a11yOutputDir ?? 'test-results/a11y-receipts')
    this.metadataOverride = options.metadata
    this.now = options.now ?? (() => new Date().toISOString())
    this.listOnly = options.listOnly ?? process.argv.some(argument => argument === '--list' || argument.startsWith('--list='))
    this.tests = []
    this.testsById = new Map()
    this.axeReceipts = new Map()
    this.a11yReceiptFailures = []
  }

  onBegin(_config, suite) {
    if (this.listOnly) return
    this.startedAt = this.now()
    this.metadata = this.metadataOverride ?? loadMetadata(this.rootDir)
    this.axeReceipts = new Map()
    this.a11yReceiptFailures = []
    this.tests = suite.allTests().map((test, sequence) => {
      const project = test.parent.project()?.name ?? 'unknown-project'
      const path = test.titlePath()
      const fileName = basename(test.location.file)
      const fileIndex = path.findIndex(part => part === fileName || part.endsWith(`/${fileName}`))
      const titleParts = fileIndex >= 0
        ? path.slice(fileIndex + 1)
        : path.filter(part => part && part !== project)
      const title = titleParts.length > 0 ? titleParts.join(' › ') : test.title
      const row = {
        sequence,
        project,
        file: relative(this.rootDir, test.location.file).replaceAll('\\', '/'),
        title,
        annotations: [...test.annotations],
        results: [],
      }
      this.testsById.set(test.id, row)
      return row
    })
  }

  onTestEnd(test, result) {
    if (this.listOnly) return
    const row = this.testsById.get(test.id)
    if (!row) return
    row.annotations = [...test.annotations]
    row.results.push(cleanResult(result))
    for (const attachment of result.attachments ?? []) {
      if (!attachment.name?.startsWith('axe-') || attachment.contentType !== 'application/json') continue
      try {
        const rendered = attachment.body
          ? Buffer.from(attachment.body).toString('utf8')
          : attachment.path ? readFileSync(attachment.path, 'utf8') : ''
        const parsed = JSON.parse(rendered)
        if (!isAxeAttachment(parsed) || parsed.project !== row.project) throw new Error('invalid Axe receipt schema')
        const receipt = buildAxeReceipt({
          project: row.project,
          surface: parsed.surface,
          path: parsed.path,
          violations: (parsed.violations ?? []).map(violation => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: (violation.targets ?? []).map(target => ({ target })),
          })),
        })
        const slug = value => sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const receiptFile = `${slug(row.project)}--${slug(receipt.surface)}.json`
        if (this.axeReceipts.has(receiptFile)) {
          this.a11yReceiptFailures.push({
            reason_code: 'axe_receipt_duplicate_target',
            receipt_file: receiptFile,
            originating_test: originatingTest(row),
          })
          continue
        }
        this.axeReceipts.set(receiptFile, bindAxeReceipt(receipt, {
          metadata: this.metadata,
          originatingTest: originatingTest(row),
        }))
      } catch {
        this.a11yReceiptFailures.push({
          reason_code: 'axe_attachment_malformed',
          attachment: attachment.name,
          originating_test: originatingTest(row),
        })
      }
    }
  }

  async onEnd(result) {
    if (this.listOnly) return
    const axeValidation = validateAxeReceipts(this.metadata, this.tests, this.axeReceipts, this.a11yReceiptFailures)
    const report = buildPlaywrightReceipt({
      metadata: this.metadata,
      startedAt: this.startedAt,
      completedAt: this.now(),
      status: result.status,
      tests: this.tests,
      a11yReceiptFailures: axeValidation.failures,
      axeReceiptValidation: axeValidation.validation,
    })
    await replaceA11yDirectory(
      this.a11yOutputDir,
      [...this.axeReceipts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    )
    await mkdir(dirname(this.outputFile), { recursive: true })
    const temporary = `${this.outputFile}.tmp`
    await writeFile(temporary, stableJson(report), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.outputFile)
    if (report.status !== 'passed') return { status: 'failed' }
  }
}
