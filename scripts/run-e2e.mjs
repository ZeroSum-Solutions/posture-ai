// Resolves the local Supabase stack's URL + keys into E2E_* env vars, then
// runs Playwright. Fails fast with a clear message if the stack is down.
import { execFileSync, spawnSync } from 'node:child_process'

// Playwright's webServer runs `npx next dev`, which does NOT trigger npm
// pre-scripts — copy the self-hosted MediaPipe WASM assets explicitly or
// detection hangs forever in fresh checkouts (CI).
execFileSync('node', ['scripts/copy-mediapipe-wasm.mjs'], { stdio: 'inherit' })

let statusOut
try {
  statusOut = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch {
  console.error('Local Supabase stack is not running. Start it with:\n  npx supabase start')
  process.exit(1)
}

const env = { ...process.env }
for (const line of statusOut.split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"$/)
  if (m) env[`SUPABASE_LOCAL_${m[1]}`] = m[2]
}

env.E2E_SUPABASE_URL = env.SUPABASE_LOCAL_API_URL
env.E2E_SUPABASE_ANON_KEY = env.SUPABASE_LOCAL_ANON_KEY
env.E2E_SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY

if (!env.E2E_SUPABASE_URL || !env.E2E_SUPABASE_ANON_KEY || !env.E2E_SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Could not parse API_URL/ANON_KEY/SERVICE_ROLE_KEY from `supabase status -o env`. Output was:\n' + statusOut)
  process.exit(1)
}

// In CI the webServer is `next start` (see playwright.config.ts), so build
// here — after the stack env is resolved, because NEXT_PUBLIC_* values are
// inlined into client bundles and the CSP connect-src at build time.
if (process.env.CI) {
  execFileSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: env.E2E_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.E2E_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
      POSTURE_TEST_MODE_ENABLED: '1',
      // All seeded muscle-KB content is clinically unreviewed; production builds
      // hide it unless this flag is set, and muscle-kb/unreviewed-content/a11y
      // specs depend on it rendering.
      NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: '1',
    },
  })
}

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
})
process.exit(result.status ?? 1)
