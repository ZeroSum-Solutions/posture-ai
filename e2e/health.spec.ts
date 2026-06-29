import { test, expect } from '@playwright/test'

// /api/health is the readiness probe: it verifies the Supabase connection and
// that the full migration chain is applied (schema 'ready' vs 'pending_migration').
// The happy path guards against shipping with a disconnected DB or a skipped
// migration. API-only, so it is browser-agnostic (runs in both projects, cheap).
test.describe('health endpoint', () => {
  test('GET /api/health -> 200 ok / connected / schema ready', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.database).toBe('connected')
    // e2e + CI run against a freshly-reset stack with every migration applied.
    expect(body.schema).toBe('ready')
    expect(typeof body.timestamp).toBe('string')
  })
})
