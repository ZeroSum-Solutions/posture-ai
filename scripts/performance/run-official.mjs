#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RESULTS = resolve(ROOT, 'test-results/performance')
const APP_ORIGIN = 'http://127.0.0.1:3100'

export function parseSupabaseEnvironment(raw) {
  const values = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/)
    if (match) values[match[1]] = match[2]
  }
  for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL']) {
    if (!values[key]) throw new Error(`Local Supabase status omitted ${key}`)
  }
  return values
}

function run(command, args, environment) {
  execFileSync(command, args, {
    cwd: ROOT,
    env: environment,
    stdio: 'inherit',
  })
}

async function waitForServer(url, child, timeoutMilliseconds = 120_000) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production Next server exited with ${child.exitCode}`)
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      // The bounded poll is intentional: the server may still be binding.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Production Next server did not become ready within ${timeoutMilliseconds}ms`)
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise))
  const timeout = new Promise(resolvePromise => setTimeout(resolvePromise, 5_000, 'timeout'))
  if (await Promise.race([exited, timeout]) === 'timeout' && child.exitCode === null) child.kill('SIGKILL')
}

function exactCommit() {
  const commit = process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Official performance run requires an exact lowercase commit SHA')
  const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (commit !== checkedOut) throw new Error('GITHUB_SHA does not match the checked-out commit')
  return commit
}

export async function runPerformance({ official }) {
  if (official && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Official performance evidence can run only in GitHub Actions')
  const supabase = parseSupabaseEnvironment(execFileSync(
    'npx',
    ['supabase', 'status', '-o', 'env'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ))
  const commit = exactCommit()
  const environment = {
    ...process.env,
    CI: '1',
    VERCEL_ENV: 'preview',
    POSTURE_TEST_MODE_ENABLED: '1',
    NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: '1',
    NEXT_PUBLIC_SUPABASE_URL: supabase.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
    PERF_APP_URL: APP_ORIGIN,
    PERF_SUPABASE_URL: supabase.API_URL,
    PERF_SUPABASE_ANON_KEY: supabase.ANON_KEY,
    PERF_SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
    PERF_DB_URL: supabase.DB_URL,
    PERF_COMMIT_SHA: commit,
    PERF_MANIFEST_PATH: resolve(RESULTS, 'fixture-manifest.json'),
    PERF_API_ARTIFACT_PATH: resolve(RESULTS, 'api-raw.json'),
    PERF_OFFICIAL_RUN: official ? '1' : '0',
    PERF_APPLICATION_MODE: 'production_next_start',
    PERFORMANCE_APPLICATION_MODE: 'production_next_start',
    PERFORMANCE_DATABASE: 'local_supabase',
  }
  rmSync(RESULTS, { recursive: true, force: true })
  mkdirSync(RESULTS, { recursive: true })
  run('node', ['scripts/copy-mediapipe-wasm.mjs'], environment)
  run('npx', ['next', 'build'], environment)
  run('npx', ['vite-node', '--config', 'vitest.config.ts', 'scripts/performance/seed.ts'], environment)

  const log = openSync(resolve(RESULTS, 'next-server.log'), 'a')
  const server = spawn('npx', ['next', 'start', '-p', '3100'], {
    cwd: ROOT,
    env: environment,
    stdio: ['ignore', log, log],
  })
  try {
    await waitForServer(`${APP_ORIGIN}/login`, server)
    run('npx', ['vite-node', '--config', 'vitest.config.ts', 'scripts/performance/run-api.ts'], environment)
    run('node', [
      'scripts/performance/run-browser.mjs',
      '--app-url', APP_ORIGIN,
      '--fixture-manifest', resolve(RESULTS, 'fixture-manifest.json'),
      '--auth', resolve(RESULTS, 'credentials.json'),
      '--output-dir', RESULTS,
      '--commit', commit,
    ], environment)
    const baseCommit = execFileSync('git', ['merge-base', commit, 'origin/main'], { cwd: ROOT, encoding: 'utf8' }).trim()
    run('node', [
      'scripts/performance/capture-query-plans.mjs',
      '--manifest', 'test-results/performance/fixture-manifest.json',
      '--output', 'test-results/performance/query-plans.json',
      '--base-commit', baseCommit,
      '--head-commit', commit,
    ], environment)
    if (official) {
      run('node', [
        'scripts/performance/check-receipts.mjs',
        '--expected-commit', commit,
      ], environment)
    } else {
      const localResult = {
        status: 'PASS_RAW_LOCAL',
        performance_status: 'LOCAL_ONLY_NOT_OFFICIAL',
        performance_claimed: false,
        commit_sha: commit,
        working_tree_dirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
      }
      writeFileSync(resolve(RESULTS, 'local-smoke-result.json'), `${JSON.stringify(localResult, null, 2)}\n`)
      process.stdout.write(`${JSON.stringify(localResult)}\n`)
    }
  } finally {
    await stopServer(server)
  }
}

export async function runOfficialPerformance() {
  return runPerformance({ official: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsAfterScript = process.argv.slice(2)
  const local = argumentsAfterScript.length === 1 && argumentsAfterScript[0] === '--local'
  if (argumentsAfterScript.length > (local ? 1 : 0)) {
    process.stderr.write('Usage: node scripts/performance/run-official.mjs [--local]\n')
    process.exitCode = 1
  } else runPerformance({ official: !local }).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
