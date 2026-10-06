import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUPABASE_URL_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'E2E_SUPABASE_URL',
  'PERF_SUPABASE_URL',
]

function readGit(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function parseEnvFile(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    const isQuoted = rawValue.length >= 2
      && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'")))
    values[key] = isQuoted ? rawValue.slice(1, -1) : rawValue
  }
  return values
}

export function isLoopbackUrl(rawValue) {
  try {
    const url = new URL(rawValue)
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    const isIpv4Loopback = /^127(?:\.(?:\d{1,3})){3}$/.test(host)
      && host.split('.').every(part => Number(part) >= 0 && Number(part) <= 255)
    return ['http:', 'https:'].includes(url.protocol)
      && (host === 'localhost' || host === '::1' || isIpv4Loopback)
  } catch {
    return false
  }
}

export function validateAutonomousQaPreflight({ branch, status, supabaseUrls }) {
  const errors = []
  if (!branch) errors.push('Git must be on an attached feature branch')
  if (branch === 'main' || branch === 'master') errors.push('Autonomous QA refuses the primary branch')
  if (status.trim()) errors.push('Autonomous QA requires a clean worktree')
  if (supabaseUrls.length === 0) errors.push('A local Supabase URL must be configured')
  if (supabaseUrls.some(({ value }) => !isLoopbackUrl(value))) {
    errors.push('Every configured Supabase URL must target loopback')
  }
  return errors
}

export function runAutonomousQaPreflight(environment = process.env) {
  const envPath = resolve(REPO_ROOT, '.env.local')
  const fileEnvironment = existsSync(envPath)
    ? parseEnvFile(readFileSync(envPath, 'utf8'))
    : {}
  const supabaseUrls = SUPABASE_URL_KEYS
    .map(key => ({ key, value: environment[key] ?? fileEnvironment[key] }))
    .filter(entry => entry.value)
  const branch = readGit(['branch', '--show-current'])
  const status = readGit(['status', '--porcelain', '--untracked-files=all'])
  const errors = validateAutonomousQaPreflight({ branch, status, supabaseUrls })
  const result = {
    ok: errors.length === 0,
    scope: 'local-only',
    branch: branch || null,
    worktree_clean: status.length === 0,
    supabase: supabaseUrls.length > 0 && errors.every(error => !error.includes('Supabase'))
      ? 'loopback'
      : 'blocked',
    prohibited_actions: ['commit', 'push', 'merge', 'deploy', 'production-data', 'real-person-data'],
    errors,
  }
  const stream = result.ok ? process.stdout : process.stderr
  stream.write(`${JSON.stringify(result)}\n`)
  return result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runAutonomousQaPreflight()
}
