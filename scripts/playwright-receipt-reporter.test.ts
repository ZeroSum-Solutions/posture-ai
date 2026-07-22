import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import PlaywrightReceiptReporter, {
  buildAxeReceipt,
  buildPlaywrightReceipt,
  normalizeReceiptPath,
  sanitizeSelector,
} from './playwright-receipt-reporter.mjs'

const metadata = {
  command: 'CI=1 npm run test:e2e',
  commit: 'a'.repeat(40),
  configuration_hash: 'b'.repeat(64),
  inventory_id: 'inventory-v1',
  inventory_hash: 'c'.repeat(64),
  project_order: ['setup', 'desktop-chromium'],
  projects: { setup: 1, 'desktop-chromium': 1 },
  expected_total: 2,
  expected_files: 2,
  approved_skips: [{
    key: 'skip:approved:mobile-webkit',
    source: 'e2e/example.spec.ts::approved guard',
    scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    test_ids: ['mobile-webkit::e2e/example.spec.ts::approved guard target'],
  }],
  axe_receipt_contract: {
    schema_version: 'posture-ai-axe-targets-v1',
    manifest_expected_total: 0,
  },
  expected_axe_targets: [],
}

function axeTarget(title: string, surface: string, path: string, project = 'desktop-chromium') {
  return {
    project,
    surface,
    path,
    originating_test: {
      project,
      file: 'e2e/a11y.spec.ts',
      title: `accessibility budget › ${title}`,
    },
  }
}

function withAxeTargets(...targets: ReturnType<typeof axeTarget>[]) {
  return {
    ...metadata,
    axe_receipt_contract: {
      schema_version: 'posture-ai-axe-targets-v1',
      manifest_expected_total: targets.length,
    },
    expected_axe_targets: targets,
  }
}

describe('Playwright receipt sanitization', () => {
  it('normalizes dynamic release routes and selector values', () => {
    const id = '34838d0e-e3e2-44bf-9181-e7d2525c0c5c'
    expect(normalizeReceiptPath(`/consent/eyJhbGciOiJIUzI1NiJ9.${'x'.repeat(32)}`)).toBe('/consent/:token')
    expect(normalizeReceiptPath(`/clients/${id}/edit`)).toBe('/clients/:id/edit')
    expect(normalizeReceiptPath(`/assessments/${id}`)).toBe('/assessments/:id')
    expect(normalizeReceiptPath(`/workouts/${id}`)).toBe('/workouts/:id')
    expect(normalizeReceiptPath('/clients/new')).toBe('/clients/new')
    expect(sanitizeSelector(`a[href="/clients/${id}"] [data-token="${'x'.repeat(40)}"]`))
      .toBe('a[href="/clients/:id"] [data-token=":token"]')
  })

  it('builds a stable minimal report without errors, output, attachments, or dynamic identifiers', () => {
    const id = '34838d0e-e3e2-44bf-9181-e7d2525c0c5c'
    const report = buildPlaywrightReceipt({
      metadata,
      startedAt: '2026-07-21T10:00:00.000Z',
      completedAt: '2026-07-21T10:01:00.000Z',
      status: 'failed',
      tests: [{
        sequence: 0,
        project: 'desktop-chromium',
        file: 'e2e/a11y.spec.ts',
        title: `result ${id}`,
        annotations: [],
        results: [{ status: 'failed', retry: 0, error: { message: 'private' }, stdout: ['private'], attachments: [{ path: '/tmp/private' }] }],
      }],
    })
    expect(report.status).toBe('failed')
    expect(report.tests).toEqual([{
      project: 'desktop-chromium',
      file: 'e2e/a11y.spec.ts',
      title: 'result :id',
      annotations: [],
      results: [{ status: 'failed', retry: 0 }],
    }])
    expect(JSON.stringify(report)).not.toMatch(/private|attachments|stdout|error/)
  })

  it.each([
    {
      label: 'missing annotation',
      annotations: [{ type: 'skip', description: 'ordinary Playwright skip' }],
      reason: 'skip_annotation_missing',
    },
    {
      label: 'malformed annotation',
      annotations: [{ type: 'production-readiness-skip', description: '{"key":' }],
      reason: 'skip_annotation_malformed',
    },
    {
      label: 'manifest mismatch',
      annotations: [{
        type: 'production-readiness-skip',
        description: JSON.stringify({
          key: 'skip:approved:mobile-webkit',
          source: 'e2e/example.spec.ts::wrong source',
          scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
        }),
      }],
      reason: 'skip_annotation_unapproved',
    },
    {
      label: 'key mismatch',
      annotations: [{
        type: 'production-readiness-skip',
        description: JSON.stringify({
          key: 'skip:not-approved:mobile-webkit',
          source: 'e2e/example.spec.ts::approved guard',
          scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
        }),
      }],
      reason: 'skip_annotation_unapproved',
    },
    {
      label: 'scope mismatch',
      annotations: [{
        type: 'production-readiness-skip',
        description: JSON.stringify({
          key: 'skip:approved:mobile-webkit',
          source: 'e2e/example.spec.ts::approved guard',
          scope: { project: 'desktop-chromium', condition: 'browserName=webkit' },
        }),
      }],
      reason: 'skip_annotation_unapproved',
    },
    {
      label: 'duplicate approval annotation',
      annotations: [
        {
          type: 'production-readiness-skip',
          description: JSON.stringify({
            key: 'skip:approved:mobile-webkit',
            source: 'e2e/example.spec.ts::approved guard',
            scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
          }),
        },
        {
          type: 'production-readiness-skip',
          description: JSON.stringify({
            key: 'skip:approved:mobile-webkit',
            source: 'e2e/example.spec.ts::approved guard',
            scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
          }),
        },
      ],
      reason: 'skip_annotation_malformed',
    },
  ])('fails closed for a skipped result with $label', ({ annotations, reason }) => {
    const report = buildPlaywrightReceipt({
      metadata,
      startedAt: '2026-07-21T10:00:00.000Z',
      completedAt: '2026-07-21T10:01:00.000Z',
      status: 'passed',
      tests: [{
        sequence: 0,
        project: 'mobile-webkit',
        file: 'e2e/example.spec.ts',
        title: 'approved guard target',
        annotations,
        results: [{ status: 'skipped', retry: 0 }],
      }],
    })
    expect(report.status).toBe('failed')
    expect(report.skip_validation_failures).toEqual([{
      reason_code: reason,
      originating_test: {
        project: 'mobile-webkit',
        file: 'e2e/example.spec.ts',
        title: 'approved guard target',
      },
    }])
    expect(report.observed_skips).toEqual([])
  })

  it('accepts only the exact manifest-approved structured skip annotation', () => {
    const approvedRow = metadata.approved_skips[0]
    const approved = { key: approvedRow.key, source: approvedRow.source, scope: approvedRow.scope }
    const report = buildPlaywrightReceipt({
      metadata,
      startedAt: '2026-07-21T10:00:00.000Z',
      completedAt: '2026-07-21T10:01:00.000Z',
      status: 'passed',
      tests: [{
        sequence: 0,
        project: 'mobile-webkit',
        file: 'e2e/example.spec.ts',
        title: 'approved guard target',
        annotations: [
          { type: 'skip', description: 'ordinary Playwright skip' },
          { type: 'production-readiness-skip', description: JSON.stringify(approved) },
        ],
        results: [{ status: 'skipped', retry: 0 }],
      }],
    })
    expect(report.status).toBe('passed')
    expect(report.skip_validation_failures).toEqual([])
    expect(report.observed_skips).toEqual([approved])
  })

  it('rejects reuse of an otherwise approved annotation by another test title', () => {
    const approvedRow = metadata.approved_skips[0]
    const approved = { key: approvedRow.key, source: approvedRow.source, scope: approvedRow.scope }
    const report = buildPlaywrightReceipt({
      metadata,
      startedAt: '2026-07-21T10:00:00.000Z',
      completedAt: '2026-07-21T10:01:00.000Z',
      status: 'passed',
      tests: [{
        sequence: 0,
        project: 'mobile-webkit',
        file: 'e2e/example.spec.ts',
        title: 'different test title',
        annotations: [{ type: 'production-readiness-skip', description: JSON.stringify(approved) }],
        results: [{ status: 'skipped', retry: 0 }],
      }],
    })
    expect(report.status).toBe('failed')
    expect(report.skip_validation_failures).toContainEqual(expect.objectContaining({ reason_code: 'skip_annotation_unapproved' }))
  })

  it('rejects an approved skip entry that omits its exact test IDs', () => {
    const report = buildPlaywrightReceipt({
      metadata: { ...metadata, approved_skips: metadata.approved_skips.map(skip => ({ key: skip.key, source: skip.source, scope: skip.scope })) },
      startedAt: '2026-07-21T10:00:00.000Z',
      completedAt: '2026-07-21T10:01:00.000Z',
      status: 'passed',
      tests: [{
        sequence: 0,
        project: 'mobile-webkit',
        file: 'e2e/example.spec.ts',
        title: 'approved guard target',
        annotations: [{
          type: 'production-readiness-skip',
          description: JSON.stringify({
            key: 'skip:approved:mobile-webkit',
            source: 'e2e/example.spec.ts::approved guard',
            scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
          }),
        }],
        results: [{ status: 'skipped', retry: 0 }],
      }],
    })
    expect(report.status).toBe('failed')
    expect(report.skip_validation_failures).toContainEqual(expect.objectContaining({ reason_code: 'skip_annotation_unapproved' }))
  })

  it('builds deterministic Axe receipts with normalized paths and sorted sanitized targets', () => {
    const id = '34838d0e-e3e2-44bf-9181-e7d2525c0c5c'
    expect(buildAxeReceipt({
      project: 'mobile-webkit',
      surface: 'client detail',
      path: `/clients/${id}`,
      violations: [{ id: 'label', impact: 'moderate', help: 'Label form controls', nodes: [
        { target: [`#z-${id}`] },
        { target: ['#a-static'] },
      ] }],
    })).toEqual({
      schema_version: 'posture-ai-axe-scan-v1',
      evidence_class: 'desktop_or_emulated_browser_automation',
      physical_device_evidence: false,
      project: 'mobile-webkit',
      surface: 'client detail',
      path: '/clients/:id',
      violations: [{
        id: 'label',
        impact: 'moderate',
        help: 'Label form controls',
        targets: [['#a-static'], ['#z-:id']],
      }],
    })
  })
})

describe('Playwright receipt reporter lifecycle', () => {
  it('does not write a receipt during --list discovery', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-list-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const reporter = new PlaywrightReceiptReporter({ outputFile, rootDir, metadata, listOnly: true })
    reporter.onBegin({} as never, { allTests: () => [] } as never)
    await reporter.onEnd({ status: 'passed' } as never)
    await expect(access(outputFile)).rejects.toThrow()
  })

  it('fails closed when discovery is reported as passed but no test executed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-unexecuted-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({ outputFile, rootDir, metadata, now: () => times.shift()! })
    const testCase = {
      id: 'test-unexecuted',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'never ran',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'never ran'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({} as never, { allTests: () => [testCase] } as never)

    const finalResult = await reporter.onEnd({ status: 'passed' } as never)
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(finalResult).toEqual({ status: 'failed' })
    expect(report.status).toBe('failed')
    expect(report.tests[0].results).toEqual([{ status: 'interrupted', retry: 0 }])
  })

  it('writes a failure receipt with only deterministic test-result fields', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-failure-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({ outputFile, rootDir, metadata, now: () => times.shift()! })
    const project = { name: 'desktop-chromium' }
    const testCase = {
      id: 'test-1',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'fails safely',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'fails safely'],
      parent: { project: () => project },
      annotations: [],
    }
    reporter.onBegin({ listOnly: false } as never, { allTests: () => [testCase] } as never)
    reporter.onTestEnd(testCase as never, {
      status: 'failed', retry: 0, error: { message: 'secret failure' }, stdout: ['secret output'], attachments: [],
    } as never)
    await reporter.onEnd({ status: 'failed' } as never)

    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(report.status).toBe('failed')
    expect(report.tests[0].results).toEqual([{ status: 'failed', retry: 0 }])
    expect(JSON.stringify(report)).not.toMatch(/secret failure|secret output|attachments|stdout|error/)
  })

  it('writes the same minimal contract on a successful run', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-success-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({
      outputFile,
      rootDir,
      metadata: withAxeTargets(axeTarget('passes safely', 'client detail', '/clients/:id')),
      now: () => times.shift()!,
    })
    const testCase = {
      id: 'test-1',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'passes safely',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'passes safely'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({ listOnly: false } as never, { allTests: () => [testCase] } as never)
    const axeReceipt = buildAxeReceipt({
      project: 'desktop-chromium',
      surface: 'client detail',
      path: `/clients/34838d0e-e3e2-44bf-9181-e7d2525c0c5c`,
      violations: [],
    })
    reporter.onTestEnd(testCase as never, {
      status: 'passed',
      retry: 0,
      attachments: [{
        name: 'axe-client-detail',
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(axeReceipt)),
      }],
    } as never)
    const finalResult = await reporter.onEnd({ status: 'passed' } as never)

    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(finalResult).toBeUndefined()
    expect(report.status).toBe('passed')
    expect(report.tests[0].results).toEqual([{ status: 'passed', retry: 0 }])
    expect(report.axe_receipt_validation).toMatchObject({
      status: 'passed',
      expected_run_total: 1,
      materialized_total: 1,
    })
    const axe = JSON.parse(await readFile(join(rootDir, 'test-results/a11y-receipts/desktop-chromium--client-detail.json'), 'utf8'))
    expect(axe.path).toBe('/clients/:id')
    expect(axe.physical_device_evidence).toBe(false)
    expect(axe.release_binding).toEqual({
      commit: metadata.commit,
      configuration_hash: metadata.configuration_hash,
      inventory_id: metadata.inventory_id,
      inventory_hash: metadata.inventory_hash,
      originating_test: {
        project: 'desktop-chromium',
        file: 'e2e/a11y.spec.ts',
        title: 'accessibility budget › passes safely',
      },
    })
  })

  it('fails closed with a stable sanitized reason when an Axe attachment is malformed', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-malformed-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const secret = '34838d0e-e3e2-44bf-9181-e7d2525c0c5c'
    const reporter = new PlaywrightReceiptReporter({
      outputFile,
      rootDir,
      metadata: withAxeTargets(axeTarget(`malformed ${secret}`, 'client detail', '/clients/:id')),
      now: () => times.shift()!,
    })
    const testCase = {
      id: 'test-malformed-secret',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: `malformed ${secret}`,
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', `malformed ${secret}`],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({ listOnly: false } as never, { allTests: () => [testCase] } as never)
    reporter.onTestEnd(testCase as never, {
      status: 'passed',
      retry: 0,
      attachments: [{
        name: `axe-client-${secret}`,
        contentType: 'application/json',
        body: Buffer.from('{"surface":'),
      }],
    } as never)

    const finalResult = await reporter.onEnd({ status: 'passed' } as never)
    const raw = await readFile(outputFile, 'utf8')
    const report = JSON.parse(raw)
    expect(finalResult).toEqual({ status: 'failed' })
    expect(report.status).toBe('failed')
    expect(report.a11y_receipt_failures).toContainEqual({
      reason_code: 'axe_attachment_malformed',
      attachment: 'axe-client-:id',
      originating_test: {
        project: 'desktop-chromium',
        file: 'e2e/a11y.spec.ts',
        title: 'accessibility budget › malformed :id',
      },
    })
    expect(report.a11y_receipt_failures).toContainEqual({
      reason_code: 'axe_receipt_missing',
      target: axeTarget('malformed :id', 'client detail', '/clients/:id'),
      originating_test: axeTarget('malformed :id', 'client detail', '/clients/:id').originating_test,
    })
    expect(raw).not.toMatch(/34838d0e|test-malformed-secret|error|stdout|stderr|attachments/)
  })

  it('fails closed instead of overwriting duplicate Axe receipt targets', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-duplicate-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({
      outputFile,
      rootDir,
      metadata: withAxeTargets(axeTarget('duplicate receipt', 'client detail', '/clients/new')),
      now: () => times.shift()!,
    })
    const testCase = {
      id: 'test-duplicate',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'duplicate receipt',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'duplicate receipt'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({ listOnly: false } as never, { allTests: () => [testCase] } as never)
    const receipt = buildAxeReceipt({
      project: 'desktop-chromium',
      surface: 'client detail',
      path: '/clients/new',
      violations: [],
    })
    reporter.onTestEnd(testCase as never, {
      status: 'passed',
      retry: 0,
      attachments: [
        { name: 'axe-client-detail-one', contentType: 'application/json', body: Buffer.from(JSON.stringify(receipt)) },
        { name: 'axe-client-detail-two', contentType: 'application/json', body: Buffer.from(JSON.stringify(receipt)) },
      ],
    } as never)

    const finalResult = await reporter.onEnd({ status: 'passed' } as never)
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(finalResult).toEqual({ status: 'failed' })
    expect(report.status).toBe('failed')
    expect(report.a11y_receipt_failures).toEqual([{
      reason_code: 'axe_receipt_duplicate_target',
      receipt_file: 'desktop-chromium--client-detail.json',
      originating_test: {
        project: 'desktop-chromium',
        file: 'e2e/a11y.spec.ts',
        title: 'accessibility budget › duplicate receipt',
      },
    }])
    const axe = JSON.parse(await readFile(join(rootDir, 'test-results/a11y-receipts/desktop-chromium--client-detail.json'), 'utf8'))
    expect(axe.release_binding.commit).toBe(metadata.commit)
  })

  it('fails closed on a missing Axe attachment and atomically clears stale files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-missing-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const a11yOutputDir = join(rootDir, 'test-results/a11y-receipts')
    await mkdir(a11yOutputDir, { recursive: true })
    await writeFile(join(a11yOutputDir, 'stale.json'), '{"stale":true}\n')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({
      outputFile,
      a11yOutputDir,
      rootDir,
      metadata: withAxeTargets(axeTarget('missing receipt', 'sign-in', '/auth/sign-in')),
      now: () => times.shift()!,
    })
    const testCase = {
      id: 'test-missing',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'missing receipt',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'missing receipt'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({} as never, { allTests: () => [testCase] } as never)
    reporter.onTestEnd(testCase as never, { status: 'passed', retry: 0, attachments: [] } as never)

    expect(await reporter.onEnd({ status: 'passed' } as never)).toEqual({ status: 'failed' })
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(report.a11y_receipt_failures).toContainEqual({
      reason_code: 'axe_receipt_missing',
      target: axeTarget('missing receipt', 'sign-in', '/auth/sign-in'),
      originating_test: axeTarget('missing receipt', 'sign-in', '/auth/sign-in').originating_test,
    })
    await expect(access(join(a11yOutputDir, 'stale.json'))).rejects.toThrow()
  })

  it('fails closed on an extra Axe target', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-extra-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const times = ['2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z']
    const reporter = new PlaywrightReceiptReporter({
      outputFile,
      rootDir,
      metadata: withAxeTargets(axeTarget('extra receipt', 'sign-in', '/auth/sign-in')),
      now: () => times.shift()!,
    })
    const testCase = {
      id: 'test-extra',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'extra receipt',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'extra receipt'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({} as never, { allTests: () => [testCase] } as never)
    const receipt = buildAxeReceipt({
      project: 'desktop-chromium', surface: 'unexpected surface', path: '/clients', violations: [],
    })
    reporter.onTestEnd(testCase as never, {
      status: 'passed', retry: 0, attachments: [{
        name: 'axe-unexpected', contentType: 'application/json', body: Buffer.from(JSON.stringify(receipt)),
      }],
    } as never)

    expect(await reporter.onEnd({ status: 'passed' } as never)).toEqual({ status: 'failed' })
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(report.a11y_receipt_failures.map((failure: { reason_code: string }) => failure.reason_code))
      .toEqual(expect.arrayContaining(['axe_receipt_missing', 'axe_receipt_unexpected_target']))
  })

  it('accepts a complete scoped subset of the full Axe target contract', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-subset-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const expected = [
      axeTarget('subset one', 'sign-in', '/auth/sign-in'),
      axeTarget('not discovered', 'dashboard', '/dashboard'),
    ]
    const reporter = new PlaywrightReceiptReporter({ outputFile, rootDir, metadata: withAxeTargets(...expected) })
    const testCase = {
      id: 'test-subset',
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: 'subset one',
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', 'accessibility budget', 'subset one'],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }
    reporter.onBegin({} as never, { allTests: () => [testCase] } as never)
    const receipt = buildAxeReceipt({ project: 'desktop-chromium', surface: 'sign-in', path: '/auth/sign-in', violations: [] })
    reporter.onTestEnd(testCase as never, {
      status: 'passed', retry: 0, attachments: [{ name: 'axe-sign-in', contentType: 'application/json', body: Buffer.from(JSON.stringify(receipt)) }],
    } as never)

    expect(await reporter.onEnd({ status: 'passed' } as never)).toBeUndefined()
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(report.status).toBe('passed')
    expect(report.axe_receipt_validation).toMatchObject({ expected_run_total: 1, materialized_total: 1, status: 'passed' })
  })

  it('accepts every exact target in a complete Axe contract run', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'posture-reporter-full-'))
    const outputFile = join(rootDir, 'playwright-results.json')
    const expected = [
      axeTarget('full one', 'sign-in', '/auth/sign-in'),
      axeTarget('full two', 'dashboard', '/dashboard'),
    ]
    const reporter = new PlaywrightReceiptReporter({ outputFile, rootDir, metadata: withAxeTargets(...expected) })
    const cases = expected.map((target, index) => ({
      id: `test-full-${index}`,
      location: { file: join(rootDir, 'e2e', 'a11y.spec.ts') },
      title: target.originating_test.title.replace('accessibility budget › ', ''),
      titlePath: () => ['desktop-chromium', 'a11y.spec.ts', ...target.originating_test.title.split(' › ')],
      parent: { project: () => ({ name: 'desktop-chromium' }) },
      annotations: [],
    }))
    reporter.onBegin({} as never, { allTests: () => cases } as never)
    for (const [index, testCase] of cases.entries()) {
      const target = expected[index]
      const receipt = buildAxeReceipt({ project: target.project, surface: target.surface, path: target.path, violations: [] })
      reporter.onTestEnd(testCase as never, {
        status: 'passed', retry: 0, attachments: [{
          name: `axe-full-${index}`, contentType: 'application/json', body: Buffer.from(JSON.stringify(receipt)),
        }],
      } as never)
    }

    expect(await reporter.onEnd({ status: 'passed' } as never)).toBeUndefined()
    const report = JSON.parse(await readFile(outputFile, 'utf8'))
    expect(report.status).toBe('passed')
    expect(report.axe_receipt_validation).toMatchObject({ expected_run_total: 2, materialized_total: 2, status: 'passed' })
  })
})
