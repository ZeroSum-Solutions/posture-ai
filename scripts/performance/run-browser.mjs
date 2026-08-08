#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, totalmem } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ROOT = resolve(import.meta.dirname, '../..')
const BUDGET_PATH = join(ROOT, 'docs/qa/performance-budgets.json')
const REQUIRED_ARGUMENTS = ['app-url', 'fixture-manifest', 'auth', 'output-dir', 'commit']
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const CAMERA_TIMEOUT_MS = 30_000

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stringAt(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null
}

export function parseCliArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help') return { help: true }
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`)
    const key = token.slice(2)
    if (!REQUIRED_ARGUMENTS.includes(key)) throw new Error(`Unknown argument: --${key}`)
    if (Object.hasOwn(result, key)) throw new Error(`Duplicate argument: --${key}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    result[key] = value
    index += 1
  }
  for (const key of REQUIRED_ARGUMENTS) {
    if (!result[key]) throw new Error(`Missing required argument: --${key}`)
  }
  if (!/^[0-9a-f]{40}$/u.test(result.commit)) {
    throw new Error('--commit must be a lowercase 40-character Git commit SHA')
  }
  return result
}

/** Performance evidence is deliberately local-only; DNS names are not accepted. */
export function assertLoopbackAppUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('--app-url must be a valid loopback URL')
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname)) {
    throw new Error('--app-url must use http(s) on 127.0.0.1, localhost, or [::1]')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('--app-url must be a credential-free loopback origin with no path, query, or fragment')
  }
  return url.origin
}

export function resolveFixtureManifest(value) {
  const manifest = object(value)
  const browser = object(manifest.browser)
  const browserTargets = object(manifest.browser_targets)
  const ids = object(manifest.ids)
  const target = object(manifest.target)
  const client = object(manifest.client)

  const fixtureId = stringAt(browser.fixture_id, browserTargets.fixture_id, manifest.fixture_id)
  const clientId = stringAt(browser.client_id, browserTargets.client_id, manifest.client_id, ids.client_id, target.client_id, client.id)
  const assessmentId = stringAt(browser.assessment_id, browserTargets.assessment_id, manifest.assessment_id, ids.assessment_id, target.assessment_id)
  const displayName = stringAt(
    browser.client_display_name,
    browserTargets.client_display_name,
    manifest.client_display_name,
    manifest.client_name,
    client.display_name,
    client.first_name && client.last_name ? `${client.first_name} ${client.last_name}` : null,
  )
  const searchQuery = stringAt(
    browser.client_search_query,
    browserTargets.client_search_query,
    manifest.client_search_query,
    displayName?.split(/\s+/u)[0],
  )

  for (const [label, value] of Object.entries({ client_id: clientId, assessment_id: assessmentId, client_display_name: displayName, client_search_query: searchQuery })) {
    if (!value) throw new Error(`Fixture manifest is missing browser ${label}`)
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(clientId) || !/^[A-Za-z0-9_-]+$/u.test(assessmentId)) {
    throw new Error('Fixture client_id and assessment_id must be URL-safe identifiers')
  }
  return {
    fixtureId,
    clientId,
    assessmentId,
    clientDisplayName: displayName,
    clientSearchQuery: searchQuery,
  }
}

/**
 * @param {unknown} value
 * @param {string | null} [fixtureId]
 */
export function resolveAuthFixture(value, fixtureId = null) {
  const root = object(value)
  const credentials = Array.isArray(root.credentials) ? root.credentials.map(object) : []
  const selected = credentials.length === 0
    ? root
    : credentials.find((credential) => fixtureId && credential.fixture_id === fixtureId)
      ?? (credentials.length === 1 ? credentials[0] : null)
  if (!selected) throw new Error(`Auth fixture has no credential for browser fixture ${fixtureId ?? '(missing fixture_id)'}`)
  const practitioner = object(selected.practitioner)
  const email = stringAt(selected.email, practitioner.email)
  const password = stringAt(selected.password, practitioner.password)
  const totpSecret = stringAt(selected.secret, selected.totp_secret, practitioner.secret, practitioner.totp_secret)
  if (!email || !password || !totpSecret) {
    throw new Error('Auth fixture must contain email, password, and a TOTP secret')
  }
  return { email, password, totpSecret }
}

function decodeBase32(value) {
  const normalized = value.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '')
  let bits = ''
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('Invalid base32 TOTP secret')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}

export function totpCode(secret, nowMs = Date.now(), options = {}) {
  const stepSeconds = options.stepSeconds ?? 30
  const digits = options.digits ?? 6
  const counter = Math.floor(nowMs / 1000 / stepSeconds)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

export function millisecondsUntilSafeTotp(nowMs = Date.now(), stepSeconds = 30, minimumRemainingMs = 3_000) {
  const stepMs = stepSeconds * 1_000
  const remaining = stepMs - (nowMs % stepMs)
  return remaining < minimumRemainingMs ? remaining + 50 : 0
}

export function calculateClsSessionWindow(entries) {
  const shifts = entries
    .filter((entry) => !entry.hadRecentInput && Number.isFinite(entry.startTime) && Number.isFinite(entry.value) && entry.value >= 0)
    .sort((left, right) => left.startTime - right.startTime)
  let maximum = 0
  let windowValue = 0
  let windowStart = 0
  let previous = 0
  for (const shift of shifts) {
    if (windowValue === 0 || shift.startTime - previous > 1_000 || shift.startTime - windowStart > 5_000) {
      windowStart = shift.startTime
      windowValue = shift.value
    } else {
      windowValue += shift.value
    }
    previous = shift.startTime
    maximum = Math.max(maximum, windowValue)
  }
  return maximum
}

export function longestInteractionDuration(entries, documentId, startTime) {
  const matches = entries.filter((entry) => entry.document_id === documentId
    && entry.entry_type === 'event'
    && Number.isFinite(entry.interaction_id)
    && entry.interaction_id > 0
    && Number.isFinite(entry.start_time)
    && entry.start_time >= startTime - 4
    && Number.isFinite(entry.duration_milliseconds)
    && entry.duration_milliseconds >= 0)
  if (matches.length === 0) return null
  return Math.max(...matches.map((entry) => entry.duration_milliseconds))
}

export function cameraReadinessFromObservedMarks(input) {
  const readiness = typeof input?.readiness === 'string' ? input.readiness : ''
  const cameraError = typeof input?.cameraError === 'string' ? input.cameraError : ''
  const poseFailed = input?.poseFailed === true
  const starts = Array.isArray(input?.startMarks)
    ? input.startMarks.filter(Number.isFinite).sort((left, right) => left - right)
    : []
  const ends = Array.isArray(input?.endMarks)
    ? input.endMarks.filter(Number.isFinite).sort((left, right) => left - right)
    : []
  const start = starts.at(-1)
  const end = start === undefined ? undefined : ends.find((candidate) => candidate >= start)
  const markEvidence = {
    start_mark_count: starts.length,
    end_mark_count: ends.length,
    observed_start_milliseconds: start ?? null,
    observed_end_milliseconds: end ?? null,
  }

  if (poseFailed || /failed/u.test(readiness) || cameraError) {
    return {
      outcome: 'failure',
      detail: cameraError || readiness,
      durationMilliseconds: start !== undefined && end !== undefined ? end - start : null,
      ...markEvidence,
    }
  }
  if (!/Posture model ready/u.test(readiness)) {
    return { outcome: 'pending', durationMilliseconds: null, ...markEvidence }
  }
  if (start === undefined || end === undefined) {
    return {
      outcome: 'pending_missing_app_marks',
      detail: 'The ready label was visible, but the application-owned camera timing marks were incomplete.',
      durationMilliseconds: null,
      ...markEvidence,
    }
  }
  return {
    outcome: 'success',
    detail: readiness,
    durationMilliseconds: end - start,
    ...markEvidence,
  }
}

export function deterministicGzip(value) {
  return gzipSync(Buffer.isBuffer(value) ? value : Buffer.from(value), { level: 9, mtime: 0 })
}

export function deterministicGzipBytes(value) {
  return deterministicGzip(value).byteLength
}

export function classifyJavascriptResource(resourceUrl, appOrigin, allowedPrefixes, neverExcludedPrefixes) {
  const parsed = new URL(resourceUrl, appOrigin)
  if (neverExcludedPrefixes.some((prefix) => parsed.origin === appOrigin && parsed.pathname.startsWith(prefix))) {
    return { included: true, matchedAllowedPrefix: null, resourceUrl: parsed.pathname + parsed.search }
  }
  const matched = allowedPrefixes.find((prefix) => parsed.origin === appOrigin && parsed.pathname.startsWith(prefix)) ?? null
  return {
    included: matched === null,
    matchedAllowedPrefix: matched,
    resourceUrl: parsed.origin === appOrigin ? parsed.pathname + parsed.search : parsed.href,
  }
}

export function normalizeResourceInventory(inventory) {
  return [...inventory].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
}

export function resolveRouteTemplate(template, fixture) {
  return template
    .replaceAll('{client_id}', encodeURIComponent(fixture.clientId))
    .replaceAll('{assessment_id}', encodeURIComponent(fixture.assessmentId))
}

export function artifactName(targetId) {
  return targetId.replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '') || 'root'
}

export function nextDifferentOptionValue(values, currentValue) {
  return values.find((value) => typeof value === 'string' && value && value !== currentValue) ?? null
}

/**
 * @param {string} browserBuild
 * @param {{ throttling: { download_bits_per_second: number, download_bytes_per_second: number, cpu_slowdown_factor: number } }} budget
 * @param {Record<string, string | undefined>} [environment]
 */
export function buildRunnerMetadata(browserBuild, budget, environment = process.env) {
  const cpuList = cpus()
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
  const runnerProvider = environment.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local'
  const rawRunnerImage = environment.ImageOS || `${platform()}-unknown`
  const runnerImage = /^ubuntu24(?:\.04)?$/u.test(rawRunnerImage) ? 'ubuntu-24.04' : rawRunnerImage
  const runnerImageVersion = environment.ImageVersion || 'unavailable'
  const runnerArchitecture = environment.RUNNER_ARCH?.toLowerCase() === 'x64' ? 'x64' : arch()
  const applicationMode = environment.PERFORMANCE_APPLICATION_MODE || 'unverified'
  const database = environment.PERFORMANCE_DATABASE || 'unverified'
  const fingerprint = {
    runner_provider: runnerProvider,
    runner_image: runnerImage,
    runner_image_version: runnerImageVersion,
    runner_architecture: runnerArchitecture,
    cpu_model: cpuList[0]?.model || 'unavailable',
    logical_cpu_cores: cpuList.length,
    memory_bytes: totalmem(),
    node_version: process.versions.node,
    browser_name: 'chromium',
    browser_build: browserBuild,
  }
  const sharedActual = {
    runner_provider: runnerProvider,
    runner_image: runnerImage,
    runner_architecture: runnerArchitecture,
    node_major: nodeMajor,
    database,
    application_mode: applicationMode,
    workers: 1,
    measurement_retries: 0,
    browser_engine: 'chromium',
    viewport_width_css_pixels: 1280,
    viewport_height_css_pixels: 720,
    device_pixel_ratio: 1,
  }
  const actualProfiles = {
    throttled_browser_camera: {
      ...sharedActual,
      network_profile: 'fixed_throttle',
      download_bits_per_second: budget.throttling.download_bits_per_second,
      download_bytes_per_second: budget.throttling.download_bytes_per_second,
      cpu_slowdown_factor: budget.throttling.cpu_slowdown_factor,
    },
    deterministic_bundle: {
      ...sharedActual,
      accounting_mode: 'deterministic_gzip',
      gzip_level: 9,
      gzip_mtime_seconds: 0,
    },
  }
  const officialEnvironment = runnerProvider === 'github_actions'
    && environment.RUNNER_OS === 'Linux'
    && runnerImage === 'ubuntu-24.04'
    && runnerArchitecture === 'x64'
    && nodeMajor === 22
    && database === 'local_supabase'
    && applicationMode === 'production_next_start'
    && runnerImageVersion !== 'unavailable'
    && typeof browserBuild === 'string'
    && browserBuild.length > 0
  return { runnerFingerprint: fingerprint, actualProfiles, officialEnvironment }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeJson(path, value) {
  await writeFile(path, prettyJson(value), 'utf8')
}

async function authenticateViaUi(browser, appOrigin, auth) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  try {
    await page.goto(`${appOrigin}/auth/sign-in`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill(auth.email)
    await page.getByLabel('Password').fill(auth.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/auth\/mfa(?:\?|$)/u, { timeout: 15_000 })
    const waitMs = millisecondsUntilSafeTotp()
    if (waitMs) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs))
    await page.getByLabel('Authenticator code').fill(totpCode(auth.totpSecret))
    await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 15_000 })
    if (new URL(page.url()).pathname === '/onboarding') {
      throw new Error('Auth fixture reached onboarding; seed current legal acceptance before benchmarking (the runner will not mutate it)')
    }
    return await context.storageState()
  } finally {
    await context.close()
  }
}

async function configureThrottle(context, page, budget) {
  const session = await context.newCDPSession(page)
  await session.send('Network.enable')
  await session.send('Network.setCacheDisabled', { cacheDisabled: false })
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: budget.throttling.download_bytes_per_second,
    uploadThroughput: budget.throttling.download_bytes_per_second,
    connectionType: 'wifi',
  })
  await session.send('Emulation.setCPUThrottlingRate', { rate: budget.throttling.cpu_slowdown_factor })
  return session
}

const PERFORMANCE_INIT_SCRIPT = () => {
  const documentId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  globalThis.__posturePerformanceDocumentId = documentId
  const emit = (entry) => {
    Promise.resolve(globalThis.__posturePerfEmit?.({ document_id: documentId, ...entry })).catch(() => {})
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) emit({ entry_type: 'lcp', start_time: entry.startTime })
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emit({ entry_type: 'layout-shift', start_time: entry.startTime, value: entry.value, had_recent_input: entry.hadRecentInput })
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emit({
          entry_type: 'event',
          name: entry.name,
          start_time: entry.startTime,
          duration_milliseconds: entry.duration,
          interaction_id: entry.interactionId,
          processing_start: entry.processingStart,
          processing_end: entry.processingEnd,
        })
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 0 })
  } catch {}
}

async function newMeasuredContext(browser, storageState, appOrigin, budget, instrument = true) {
  const entries = []
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    permissions: ['camera'],
    baseURL: appOrigin,
    serviceWorkers: 'block',
  })
  if (instrument) {
    await context.exposeBinding('__posturePerfEmit', (_source, entry) => { entries.push(entry) })
    await context.addInitScript(PERFORMANCE_INIT_SCRIPT)
  }
  const page = await context.newPage()
  const cdp = await configureThrottle(context, page, budget)
  return { context, page, cdp, entries }
}

async function settleHydration(page) {
  await page.waitForFunction(() => document.readyState === 'complete')
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))))
  await page.waitForTimeout(100)
}

async function documentClock(page) {
  return page.evaluate(() => ({ documentId: globalThis.__posturePerformanceDocumentId, now: performance.now() }))
}

async function waitForInteraction(entries, documentId, startTime, timeoutMs = 750) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const duration = longestInteractionDuration(entries, documentId, startTime)
    if (duration !== null) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
      const raw = entries.filter((entry) => entry.document_id === documentId
        && entry.entry_type === 'event'
        && entry.interaction_id > 0
        && entry.start_time >= startTime - 4)
      return { durationMilliseconds: longestInteractionDuration(raw, documentId, startTime), rawEvents: raw }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  // Chromium clamps Event Timing's durationThreshold to 16 ms. A completed,
  // selected interaction with no entry is therefore a censored sub-16 ms
  // observation, not permission to invent a wall-clock surrogate.
  return { durationMilliseconds: 0, rawEvents: [], censoredBelowMilliseconds: 16 }
}

async function measuredInteraction(page, entries, stepId, action, after) {
  const clock = await documentClock(page)
  await action()
  const timing = await waitForInteraction(entries, clock.documentId, clock.now)
  if (after) await after()
  return {
    interaction_step_id: stepId,
    duration_milliseconds: timing.durationMilliseconds,
    event_timing_entries: timing.rawEvents,
    ...(timing.censoredBelowMilliseconds
      ? { event_timing_censored_below_milliseconds: timing.censoredBelowMilliseconds }
      : {}),
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function clientPickerButton(page, fixture) {
  return page.getByRole('button', { name: new RegExp(escapeRegExp(fixture.clientDisplayName), 'u') }).first()
}

async function fillSearchAsInteraction(page, entries, fixture, stepId = 'type_client_search_query') {
  const search = page.getByLabel('Search clients by name')
  return measuredInteraction(page, entries, stepId, async () => {
    await search.pressSequentially(fixture.clientSearchQuery, { delay: 12 })
  })
}

function journeyDefinitions(fixture) {
  const clientPath = `/clients/${encodeURIComponent(fixture.clientId)}`
  return [
    {
      targetId: 'client_selection_journey',
      path: '/clients',
      traceId: 'client_selection_search_and_open',
      ready: (page) => page.getByLabel('Search clients by name').waitFor({ state: 'visible' }),
      run: async (page, entries) => {
        const search = page.getByLabel('Search clients by name')
        const steps = []
        steps.push(await measuredInteraction(page, entries, 'focus_client_search', () => search.click()))
        steps.push(await fillSearchAsInteraction(page, entries, fixture))
        const result = page.locator(`a[href="${clientPath}"]`)
        await result.waitFor({ state: 'visible' })
        steps.push(await measuredInteraction(page, entries, 'activate_client_result', () => result.click({ noWaitAfter: true }), () => page.waitForURL((url) => url.pathname === clientPath)))
        return steps
      },
    },
    {
      targetId: 'assessment_start_journey',
      path: '/assessments/new',
      traceId: 'assessment_start_select_and_advance',
      ready: (page) => page.getByLabel('Search clients by name').waitFor({ state: 'visible' }),
      run: async (page, entries) => {
        const search = page.getByLabel('Search clients by name')
        const steps = []
        steps.push(await measuredInteraction(page, entries, 'focus_client_search', () => search.click()))
        steps.push(await fillSearchAsInteraction(page, entries, fixture))
        const result = clientPickerButton(page, fixture)
        await result.waitFor({ state: 'visible' })
        steps.push(await measuredInteraction(page, entries, 'activate_client_result', () => result.click(), () => page.getByTestId('selected-client-summary').waitFor()))
        const next = page.getByRole('button', { name: 'Next: Upload Views', exact: true })
        steps.push(await measuredInteraction(page, entries, 'activate_next_upload_views', () => next.click(), () => page.getByTestId('capture-disclaimer').waitFor({ timeout: 15_000 })))
        return steps
      },
    },
    {
      targetId: 'client_history_progress_compare_journey',
      path: clientPath,
      traceId: 'client_history_progress_compare_tabs',
      // The redesign removed the Progress TAB. The score history is no longer
      // gated behind a tab at all -- TrendChart renders above the tab strip and
      // reveals its score table from a "Recorded scores" button. The tabs are
      // now Findings / Compare / Details.
      //
      // The step keeps its id. docs/qa/performance-budgets.json is frozen under
      // a hardcoded sha256 and a versioned source id in
      // generate-production-readiness-inventory.mjs, so renaming a step id there
      // is a governed re-baseline, not a test fix. What this step has always
      // measured is "reveal this client's progress"; that interaction still
      // exists, it is a disclosure now rather than a tab. Driving the real
      // control keeps the budget measuring the thing it was calibrated on.
      // Re-baselining the id belongs with the perf release process.
      ready: (page) => page.getByRole('button', { name: 'Recorded scores', exact: true }).waitFor({ state: 'visible' }),
      run: async (page, entries) => {
        const steps = []
        const progress = page.getByRole('button', { name: 'Recorded scores', exact: true })
        steps.push(await measuredInteraction(page, entries, 'activate_progress_tab', () => progress.click(), () => page.locator('#client-score-table').waitFor()))
        const compare = page.getByRole('tab', { name: 'Compare', exact: true })
        steps.push(await measuredInteraction(page, entries, 'activate_compare_tab', () => compare.click(), () => page.getByLabel('Before (baseline)').waitFor()))
        const selector = page.getByLabel('Before (baseline)')
        const before = await selector.inputValue()
        const optionValues = await selector.locator('option').evaluateAll((options) => options.map((option) => option.value))
        const nextValue = nextDifferentOptionValue(optionValues, before)
        if (!nextValue) throw new Error('Before (baseline) selector needs at least two comparable assessments')
        steps.push(await measuredInteraction(page, entries, 'select_prior_assessment', async () => {
          await selector.selectOption(nextValue)
        }))
        if (await selector.inputValue() !== nextValue) throw new Error('Before (baseline) selector did not select the requested assessment')
        return steps
      },
    },
    {
      targetId: 'assessment_results_journey',
      path: `/assessments/${encodeURIComponent(fixture.assessmentId)}`,
      traceId: 'assessment_results_compare_selection',
      // The review redesign moved ReviewDock inside a collapsed "Report, share
      // & compare" <details>, so this select is present but hidden on load and
      // the old ready hook waited on it until it timed out.
      //
      // ready only waits for the disclosure to exist; the opening happens at the
      // top of run(), before the first measuredInteraction. That split matters:
      // ready is awaited inside measureWebVitalNavigation, before the LCP/CLS
      // cutoff, and any real user input there would finalize LCP early and
      // understate it against this journey's frozen baseline. Opening in run()
      // keeps the navigation vitals input-free while still leaving the two
      // measured interactions exactly what they always were.
      ready: (page) => page.locator('summary', { hasText: 'Report, share & compare' }).waitFor({ state: 'visible' }),
      run: async (page, entries) => {
        const selector = page.getByLabel('Compare report')
        const steps = []
        if (!(await selector.isVisible())) {
          await page.locator('summary', { hasText: 'Report, share & compare' }).click()
          await selector.waitFor({ state: 'visible' })
        }
        steps.push(await measuredInteraction(page, entries, 'open_compare_selector', () => selector.click()))
        const before = await selector.inputValue()
        const optionValues = await selector.locator('option').evaluateAll((options) => options.map((option) => option.value))
        const nextValue = nextDifferentOptionValue(optionValues, before)
        if (!nextValue) throw new Error('Compare report selector needs at least two assessments')
        steps.push(await measuredInteraction(page, entries, 'select_prior_assessment', async () => {
          await selector.selectOption(nextValue)
        }))
        const after = await selector.inputValue()
        if (after !== nextValue) throw new Error('Compare report selector did not choose the requested assessment')
        return steps
      },
    },
  ]
}

async function measureWebVitalNavigation(browser, storageState, appOrigin, budget, fixture, journey, phase, iteration) {
  const measured = await newMeasuredContext(browser, storageState, appOrigin, budget, true)
  const contextId = `${journey.targetId}-${phase}-${String(iteration).padStart(2, '0')}`
  try {
    await measured.page.goto(`${appOrigin}${journey.path}`, { waitUntil: 'domcontentloaded' })
    await journey.ready(measured.page)
    await settleHydration(measured.page)
    const cutoff = await documentClock(measured.page)
    await measured.page.waitForTimeout(100)
    const lcpEntries = measured.entries.filter((entry) => entry.document_id === cutoff.documentId && entry.entry_type === 'lcp' && entry.start_time <= cutoff.now)
    const shiftEntries = measured.entries
      .filter((entry) => entry.document_id === cutoff.documentId && entry.entry_type === 'layout-shift' && entry.start_time <= cutoff.now)
      .map((entry) => ({ startTime: entry.start_time, value: entry.value, hadRecentInput: entry.had_recent_input }))
    if (lcpEntries.length === 0) throw new Error('No LargestContentfulPaint entry was observed before the interaction-ready cutoff')
    const lcp = Math.max(...lcpEntries.map((entry) => entry.start_time))
    const interactions = await journey.run(measured.page, measured.entries)
    return {
      measurement_context_id: contextId,
      sample_phase: phase,
      iteration,
      outcome: 'success',
      timing_start_event: 'navigation_start',
      timing_end_event: 'route_hydrated_and_first_interaction_ready',
      readiness_cutoff_milliseconds: cutoff.now,
      lcp_milliseconds: lcp,
      cls_ratio: calculateClsSessionWindow(shiftEntries),
      interaction_trace_id: journey.traceId,
      interaction_steps: interactions,
      inp_milliseconds: Math.max(...interactions.map((entry) => entry.duration_milliseconds)),
    }
  } catch (error) {
    return {
      measurement_context_id: contextId,
      sample_phase: phase,
      iteration,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await measured.cdp.detach().catch(() => {})
    await measured.context.close()
  }
}

async function runWebVitals(browser, storageState, appOrigin, budget, fixture) {
  const warmups = budget.measurement_protocols.web_vitals.warmup_navigations_per_route
  const measuredCount = budget.measurement_protocols.web_vitals.measured_navigations_per_route
  const journeys = []
  for (const journey of journeyDefinitions(fixture)) {
    const samples = []
    for (let index = 0; index < warmups; index += 1) {
      samples.push(await measureWebVitalNavigation(browser, storageState, appOrigin, budget, fixture, journey, 'warmup', index + 1))
    }
    for (let index = 0; index < measuredCount; index += 1) {
      samples.push(await measureWebVitalNavigation(browser, storageState, appOrigin, budget, fixture, journey, 'measured', index + 1))
    }
    journeys.push({ target_id: journey.targetId, path: journey.path, interaction_trace_id: journey.traceId, samples })
  }
  return journeys
}

function javascriptReady(page, template) {
  if (template === '/dashboard') return page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' })
  if (template === '/clients') return page.getByLabel('Search clients by name').waitFor({ state: 'visible' })
  if (template === '/clients/new') return page.getByRole('heading', { name: 'New client', exact: true }).waitFor({ state: 'visible' })
  if (template === '/clients/{client_id}') return page.getByRole('tablist', { name: 'Client workspace' }).waitFor({ state: 'visible' })
  if (template === '/clients/{client_id}/edit') return page.getByLabel('First Name').waitFor({ state: 'visible' })
  if (template === '/assessments/new') return page.getByLabel('Search clients by name').waitFor({ state: 'visible' })
  if (template === '/assessments/{assessment_id}') return page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' })
  if (template === '/settings') return page.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'visible' })
  throw new Error(`No JavaScript readiness selector is defined for ${template}`)
}

async function discoverJavascriptRoute(browser, storageState, appOrigin, budget, fixture, template, outputDirectory) {
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    baseURL: appOrigin,
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const responses = []
  let accepting = true
  page.on('response', (response) => {
    if (!accepting || response.request().resourceType() !== 'script') return
    responses.push((async () => {
      await response.finished()
      const body = await response.body()
      return {
        url: response.url(),
        status: response.status(),
        content_type: response.headers()['content-type'] ?? null,
        decoded_bytes: body.byteLength,
        gzip_bytes: deterministicGzipBytes(body),
        body_sha256: sha256(body),
      }
    })())
  })
  const route = resolveRouteTemplate(template, fixture)
  try {
    await page.goto(`${appOrigin}${route}`, { waitUntil: 'domcontentloaded' })
    await javascriptReady(page, template)
    await settleHydration(page)
    accepting = false
    const rawResources = await Promise.all(responses)
    const byUrl = new Map()
    for (const resource of rawResources) {
      const existing = byUrl.get(resource.url)
      if (existing && existing.body_sha256 !== resource.body_sha256) {
        throw new Error(`JavaScript resource changed bytes during discovery: ${resource.url}`)
      }
      byUrl.set(resource.url, resource)
    }
    const included = []
    const excluded = []
    const resources = []
    for (const resource of [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url))) {
      const classification = classifyJavascriptResource(
        resource.url,
        appOrigin,
        budget.measurement_definitions.initial_application_javascript.allowed_excluded_url_prefixes,
        budget.measurement_definitions.initial_application_javascript.never_excluded_url_prefixes,
      )
      const detail = { ...resource, resource_url: classification.resourceUrl }
      delete detail.url
      resources.push(detail)
      if (classification.included) included.push({ resource_url: classification.resourceUrl, gzip_bytes: resource.gzip_bytes })
      else excluded.push({ resource_url: classification.resourceUrl, gzip_bytes: resource.gzip_bytes, matched_allowed_url_prefix: classification.matchedAllowedPrefix })
    }
    if (included.length === 0) throw new Error(`No included JavaScript resources were discovered for ${template}`)
    const normalizedIncluded = normalizeResourceInventory(included)
    const normalizedExcluded = normalizeResourceInventory(excluded)
    const inventory = {
      target_id: template,
      included_resource_inventory: normalizedIncluded,
      excluded_resource_inventory: normalizedExcluded,
    }
    const artifact = {
      artifact_kind: 'initial_javascript_raw_discovery',
      target_id: template,
      resolved_route: route,
      accounting_start_event: 'navigation_start',
      readiness_cutoff_event: 'route_hydrated_and_first_interaction_ready',
      resources,
    }
    const artifactBytes = prettyJson(artifact)
    const artifactPath = join(outputDirectory, `${artifactName(template)}.json`)
    await writeFile(artifactPath, artifactBytes, 'utf8')
    return {
      target_id: template,
      resolved_route: route,
      discovery_artifact: `javascript-discovery/${basename(artifactPath)}`,
      discovery_artifact_sha256: sha256(artifactBytes),
      discovery_inventory_sha256: sha256(canonicalJson(inventory)),
      ...inventory,
      total_included_gzip_bytes: normalizedIncluded.reduce((sum, resource) => sum + resource.gzip_bytes, 0),
      outcome: 'success',
    }
  } catch (error) {
    accepting = false
    await Promise.allSettled(responses)
    return {
      target_id: template,
      resolved_route: route,
      outcome: 'failure',
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await context.close()
  }
}

async function runJavascriptDiscovery(browser, storageState, appOrigin, budget, fixture, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true })
  const results = []
  for (const template of budget.targets.initial_application_javascript_routes) {
    results.push(await discoverJavascriptRoute(browser, storageState, appOrigin, budget, fixture, template, outputDirectory))
  }
  return results
}

async function measureCameraPage(context, page, cdp, appOrigin, fixture, cacheProfile, iteration) {
  const contextId = `${cacheProfile}-${String(iteration).padStart(2, '0')}`
  try {
    await page.goto(`${appOrigin}/assessments/new?client_id=${encodeURIComponent(fixture.clientId)}`, { waitUntil: 'domcontentloaded' })
    const selected = page.getByTestId('selected-client-summary')
    await selected.waitFor({ state: 'visible', timeout: 15_000 })
    if (!(await selected.textContent())?.includes(fixture.clientDisplayName)) {
      throw new Error('The capture route did not select the fixture client')
    }
    await page.getByRole('button', { name: 'Next: Upload Views', exact: true }).click()
    await page.getByTestId('capture-disclaimer').waitFor({ timeout: 15_000 })
    await page.getByTestId('capture-disclaimer-dismiss').click()
    const state = await page.waitForFunction(() => {
      const readinessElement = document.querySelector('[data-testid="pose-readiness"]')
      const readiness = readinessElement?.textContent ?? ''
      const cameraError = document.querySelector('[data-testid="camera-error-msg"]')?.textContent ?? ''
      const poseFailed = readinessElement?.getAttribute('role') === 'alert'
      const startMarks = performance.getEntriesByName('assessment_capture_route_navigation_start', 'mark').map((entry) => entry.startTime)
      const endMarks = performance.getEntriesByName('pose_runtime_ready_for_first_inference', 'mark').map((entry) => entry.startTime)
      if (poseFailed || cameraError) return { readiness, cameraError, poseFailed, startMarks, endMarks }
      if (/Posture model ready/u.test(readiness) && startMarks.length > 0 && endMarks.some((end) => end >= startMarks.at(-1))) {
        return { readiness, cameraError, poseFailed, startMarks, endMarks }
      }
      return null
    }, { timeout: CAMERA_TIMEOUT_MS })
    const observed = await state.jsonValue()
    const result = cameraReadinessFromObservedMarks(observed)
    return {
      measurement_context_id: contextId,
      cache_profile: cacheProfile,
      timing_start_event: 'assessment_capture_route_navigation_start',
      timing_end_event: 'pose_runtime_ready_for_first_inference',
      duration_milliseconds: result.durationMilliseconds,
      readiness_outcome: result.outcome,
      readiness_detail: result.detail,
      app_timing_marks: {
        start_mark_count: result.start_mark_count,
        end_mark_count: result.end_mark_count,
        observed_start_milliseconds: result.observed_start_milliseconds,
        observed_end_milliseconds: result.observed_end_milliseconds,
      },
    }
  } catch (error) {
    const observed = await page.evaluate(() => ({
      readiness: document.querySelector('[data-testid="pose-readiness"]')?.textContent ?? '',
      cameraError: document.querySelector('[data-testid="camera-error-msg"]')?.textContent ?? '',
      poseFailed: document.querySelector('[data-testid="pose-readiness"]')?.getAttribute('role') === 'alert',
      startMarks: performance.getEntriesByName('assessment_capture_route_navigation_start', 'mark').map((entry) => entry.startTime),
      endMarks: performance.getEntriesByName('pose_runtime_ready_for_first_inference', 'mark').map((entry) => entry.startTime),
    })).catch(() => ({ readiness: '', cameraError: '', poseFailed: false, startMarks: [], endMarks: [] }))
    const result = cameraReadinessFromObservedMarks(observed)
    const missingMarks = result.outcome === 'pending_missing_app_marks'
    return {
      measurement_context_id: contextId,
      cache_profile: cacheProfile,
      timing_start_event: 'assessment_capture_route_navigation_start',
      timing_end_event: 'pose_runtime_ready_for_first_inference',
      duration_milliseconds: result.durationMilliseconds,
      readiness_outcome: error?.name === 'TimeoutError' ? 'timeout' : 'failure',
      error: missingMarks
        ? result.detail
        : error instanceof Error ? error.message : String(error),
      readiness_detail: observed.readiness || observed.cameraError || null,
      app_timing_marks: {
        start_mark_count: result.start_mark_count,
        end_mark_count: result.end_mark_count,
        observed_start_milliseconds: result.observed_start_milliseconds,
        observed_end_milliseconds: result.observed_end_milliseconds,
      },
    }
  } finally {
    await cdp.detach().catch(() => {})
    await page.close().catch(() => {})
  }
}

async function newCameraPage(context, budget) {
  const page = await context.newPage()
  const cdp = await configureThrottle(context, page, budget)
  return { page, cdp }
}

async function runCamera(browser, storageState, appOrigin, budget, fixture) {
  const coldCount = budget.measurement_protocols.camera.cold_fresh_context_observations
  const warmCount = budget.measurement_protocols.camera.warm_cached_observations
  const cold = []
  for (let index = 0; index < coldCount; index += 1) {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      permissions: ['camera'],
      baseURL: appOrigin,
      serviceWorkers: 'block',
    })
    try {
      const measured = await newCameraPage(context, budget)
      cold.push(await measureCameraPage(context, measured.page, measured.cdp, appOrigin, fixture, 'cold_fresh_context', index + 1))
    } finally {
      await context.close()
    }
  }

  const warmContext = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    permissions: ['camera'],
    baseURL: appOrigin,
    serviceWorkers: 'block',
  })
  const warm = []
  let prime
  try {
    const primingPage = await newCameraPage(warmContext, budget)
    prime = await measureCameraPage(warmContext, primingPage.page, primingPage.cdp, appOrigin, fixture, 'warm_cache_prime', 0)
    for (let index = 0; index < warmCount; index += 1) {
      const measured = await newCameraPage(warmContext, budget)
      warm.push(await measureCameraPage(warmContext, measured.page, measured.cdp, appOrigin, fixture, 'warm_cached', index + 1))
    }
  } finally {
    await warmContext.close()
  }
  return { cold, warm_cache_prime: prime, warm }
}

function implementationFindings(webVitals, javascript, camera) {
  const findings = []
  for (const journey of webVitals) {
    for (const sample of journey.samples.filter((entry) => entry.outcome !== 'success')) {
      findings.push(`${journey.target_id}/${sample.sample_phase}-${sample.iteration}: ${sample.error}`)
    }
  }
  for (const route of javascript.filter((entry) => entry.outcome !== 'success')) {
    findings.push(`javascript ${route.target_id}: ${route.error}`)
  }
  for (const sample of [...camera.cold, camera.warm_cache_prime, ...camera.warm].filter(Boolean)) {
    if (sample.readiness_outcome !== 'success') findings.push(`camera ${sample.measurement_context_id}: ${sample.error ?? sample.readiness_detail}`)
  }
  return findings
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('Usage: node scripts/performance/run-browser.mjs --app-url http://127.0.0.1:3100 --fixture-manifest PATH --auth PATH --output-dir PATH --commit 40_CHAR_SHA\n')
    return
  }
  const appOrigin = assertLoopbackAppUrl(args['app-url'])
  const [budget, fixtureJson, authJson] = await Promise.all([
    readFile(BUDGET_PATH, 'utf8').then(JSON.parse),
    readFile(resolve(args['fixture-manifest']), 'utf8').then(JSON.parse),
    readFile(resolve(args.auth), 'utf8').then(JSON.parse),
  ])
  const fixture = resolveFixtureManifest(fixtureJson)
  const auth = resolveAuthFixture(authJson, fixture.fixtureId)
  const outputDirectory = resolve(args['output-dir'])
  await mkdir(outputDirectory, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const runnerMetadata = buildRunnerMetadata(browser.version(), budget)
  let webVitals = []
  let javascript = []
  let camera = { cold: [], warm_cache_prime: null, warm: [] }
  try {
    // This is a real password + TOTP UI login. Subsequent empty-cache contexts
    // receive only its authenticated AAL2 storage state; no auth API shortcut is used.
    const storageState = await authenticateViaUi(browser, appOrigin, auth)
    webVitals = await runWebVitals(browser, storageState, appOrigin, budget, fixture)
    await writeJson(join(outputDirectory, 'web-vitals.raw.json'), {
      artifact_kind: 'web_vitals_raw_measurements_not_receipts',
      commit_sha: args.commit,
      journeys: webVitals,
    })
    javascript = await runJavascriptDiscovery(browser, storageState, appOrigin, budget, fixture, join(outputDirectory, 'javascript-discovery'))
    await writeJson(join(outputDirectory, 'javascript.raw.json'), {
      artifact_kind: 'initial_javascript_raw_measurements_not_receipts',
      commit_sha: args.commit,
      routes: javascript,
    })
    camera = await runCamera(browser, storageState, appOrigin, budget, fixture)
    await writeJson(join(outputDirectory, 'camera.raw.json'), {
      artifact_kind: 'camera_readiness_raw_measurements_not_receipts',
      commit_sha: args.commit,
      ...camera,
    })
  } finally {
    await browser.close()
  }

  const findings = implementationFindings(webVitals, javascript, camera)
  await writeJson(join(outputDirectory, 'run-metadata.json'), {
    artifact_kind: 'browser_performance_raw_run_metadata_not_receipt',
    commit_sha: args.commit,
    budget_contract_id: budget.contract_id,
    app_origin: appOrigin,
    fixture_manifest: basename(args['fixture-manifest']),
    auth_fixture: basename(args.auth),
    protocols: budget.measurement_protocols,
    profile: budget.measurement_profiles.find((entry) => entry.profile_id === 'throttled_browser_camera'),
    deterministic_bundle_profile: budget.measurement_profiles.find((entry) => entry.profile_id === 'deterministic_bundle'),
    runner_fingerprint: runnerMetadata.runnerFingerprint,
    actual_execution_profiles: runnerMetadata.actualProfiles,
    official_environment: runnerMetadata.officialEnvironment,
    implementation_findings: findings,
  })
  if (findings.length > 0) {
    throw new Error(`Browser performance run is incomplete:\n- ${findings.join('\n- ')}`)
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS_RAW_ARTIFACTS', output_directory: outputDirectory })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
