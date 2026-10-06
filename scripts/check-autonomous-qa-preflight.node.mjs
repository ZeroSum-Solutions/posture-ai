import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isLoopbackUrl,
  parseEnvFile,
  validateAutonomousQaPreflight,
} from './check-autonomous-qa-preflight.mjs'

test('accepts a clean feature branch with loopback Supabase', () => {
  assert.deepEqual(validateAutonomousQaPreflight({
    branch: 'codex/qa-pass',
    status: '',
    supabaseUrls: [{ key: 'NEXT_PUBLIC_SUPABASE_URL', value: 'http://127.0.0.1:54321' }],
  }), [])
})

test('rejects primary, detached, and dirty worktrees', () => {
  const local = [{ key: 'NEXT_PUBLIC_SUPABASE_URL', value: 'http://localhost:54321' }]
  assert.match(validateAutonomousQaPreflight({ branch: 'main', status: '', supabaseUrls: local }).join(' '), /primary branch/)
  assert.match(validateAutonomousQaPreflight({ branch: '', status: '', supabaseUrls: local }).join(' '), /attached feature branch/)
  assert.match(validateAutonomousQaPreflight({ branch: 'codex/qa-pass', status: ' M file', supabaseUrls: local }).join(' '), /clean worktree/)
})

test('rejects absent, remote, malformed, and deceptive Supabase URLs', () => {
  assert.match(validateAutonomousQaPreflight({ branch: 'codex/qa-pass', status: '', supabaseUrls: [] }).join(' '), /must be configured/)
  for (const value of [
    'https://project.supabase.co',
    'https://localhost.example.com',
    'file:///tmp/supabase',
    'not-a-url',
  ]) {
    assert.equal(isLoopbackUrl(value), false)
  }
})

test('accepts loopback URL variants and parses quoted env values', () => {
  for (const value of [
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://127.22.33.44:54321',
    'http://[::1]:54321',
  ]) {
    assert.equal(isLoopbackUrl(value), true)
  }
  assert.deepEqual(parseEnvFile([
    'NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"',
    "export E2E_SUPABASE_URL='http://localhost:54321'",
    'IGNORED LINE',
  ].join('\n')), {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    E2E_SUPABASE_URL: 'http://localhost:54321',
  })
})
