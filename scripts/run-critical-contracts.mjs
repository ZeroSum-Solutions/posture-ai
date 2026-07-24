#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const CRITICAL_CONTRACT_FILES = Object.freeze({
  scoring: [
    'lib/findings/buildFindingRow.test.ts',
    'lib/findings/observations.test.ts',
    'lib/findings/storedFindingToEngine.test.ts',
    'lib/program/buildProgram.test.ts',
    'lib/program/clinicalProjection.test.ts',
    'lib/program/coherence.test.ts',
    'lib/program/contraindication.test.ts',
    'lib/program/dosage.test.ts',
    'lib/program/selectPriorities.test.ts',
    'lib/scoring/grade-display.test.ts',
    'lib/scoring/result-copy.test.ts',
  ],
  comparison: [
    'app/clients/[id]/comparison.test.ts',
    'lib/comparison/consumer-parity.test.tsx',
    'lib/comparison/policy.test.ts',
    'lib/comparison/trends.test.ts',
    'lib/reports/clientComparison.test.ts',
    'lib/reports/clientProgram.test.ts',
  ],
  capture: [
    'app/api/assessments/[id]/route.test.ts',
    'app/api/assessments/[id]/status/route.test.ts',
    'app/api/assessments/route.test.ts',
    'app/assessments/new/__tests__/FullScreenCapture.hard-failure.test.tsx',
    'app/assessments/new/__tests__/FullScreenCapture.lifecycle.test.tsx',
    'app/assessments/new/__tests__/FullScreenCapture.pixel-quality.test.tsx',
    'app/assessments/new/__tests__/FullScreenCapture.warning-caption.test.tsx',
    'app/assessments/new/__tests__/slots.test.ts',
    'lib/assessments/submission.test.ts',
    'lib/capture/correction.test.ts',
    'lib/capture/object-urls.test.ts',
    'lib/capture/orientation-math.test.ts',
    'lib/capture/overlay-transform.test.ts',
    'lib/capture/pixel-quality-test-hooks.test.ts',
    'lib/capture/pixel-quality.matrix.test.ts',
    'lib/capture/pixel-quality.test.ts',
    'lib/capture/pixel-sample.test.ts',
    'lib/capture/shutter-gate.test.ts',
    'lib/capture/submission-guard.test.ts',
    'lib/capture/support-anchor.test.ts',
    'lib/capture/use-camera-level.test.tsx',
    'lib/capture/use-wake-lock.test.tsx',
    'lib/captures/captures.test.ts',
    'lib/pose/async-deadline.test.ts',
    'lib/pose/capture-runtime.test.ts',
    'lib/pose/detect.lifecycle.test.ts',
    'lib/pose/detect.test.ts',
    'lib/pose/face-min.test.ts',
    'lib/pose/live-backend.test.ts',
    'lib/pose/live-frame-gate.test.ts',
    'lib/pose/live-telemetry.test.ts',
    'lib/pose/quality-score.test.ts',
    'lib/pose/quality.test.ts',
  ],
  auth: [
    'app/api/auth/complete-invitation/route.test.ts',
    'app/api/auth/sign-out/route.test.ts',
    'app/auth/accept-invite/page.test.tsx',
    'app/auth/callback/route.test.ts',
    'app/auth/confirm/route.test.ts',
    'app/auth/mfa/page.test.tsx',
    'app/auth/sign-up/page.test.tsx',
    'app/auth/update-password/page.test.tsx',
    'lib/auth/password.test.ts',
    'lib/auth/public-paths.test.ts',
    'lib/auth/requirePractitioner.test.ts',
    'lib/auth/safe-next.test.ts',
    'proxy.test.ts',
    'scripts/practitioner-access.test.ts',
    'scripts/testing/totp.test.ts',
  ],
  consent_lifecycle: [
    'app/api/clients/[id]/route.test.ts',
    'app/api/consent/link/route.test.ts',
    'app/api/consent/respond/route.test.ts',
    'app/api/consent/route.test.ts',
    'app/api/consent/withdraw/route.test.ts',
    'app/api/internal/privacy-maintenance/route.test.ts',
    'app/api/privacy/erasure-status/route.test.ts',
    'app/consent/[token]/page.test.tsx',
    'lib/consent/policy.test.ts',
    'lib/consent/record.test.ts',
    'lib/consent/token.test.ts',
    'lib/privacy/storageDeletion.test.ts',
  ],
  workout_state: [
    'app/api/workouts/route.test.ts',
    'app/api/workouts/shares/route.test.ts',
    'app/api/workouts/token/[token]/route.test.ts',
    'app/workouts/_player/RateForm.test.tsx',
    'lib/workout/buildSessionFromAssessment.test.ts',
    'lib/workout/cues.test.ts',
    'lib/workout/generateWorkoutSession.test.ts',
    'lib/workout/playerMachine.test.ts',
    'lib/workout/rating.test.ts',
    'lib/workout/runState.test.ts',
    'lib/workout/token.test.ts',
    'lib/workout/tokenProjection.test.ts',
    'lib/workout/voicePack.test.ts',
  ],
  migration_guards: [
    'supabase/tests/bounded_history_indexes_test.sql',
    'supabase/tests/clinical_content_governance_test.sql',
    'supabase/tests/legal_document_provenance_test.sql',
    'supabase/tests/privacy_lifecycle_test.sql',
  ],
})

const EXPECTED_CATEGORIES = [
  'auth',
  'capture',
  'comparison',
  'consent_lifecycle',
  'migration_guards',
  'scoring',
  'workout_state',
]

export function validateCriticalContractInventory(root = ROOT) {
  const errors = []
  const categories = Object.keys(CRITICAL_CONTRACT_FILES).sort()
  if (JSON.stringify(categories) !== JSON.stringify(EXPECTED_CATEGORIES)) {
    errors.push(`category set changed: ${categories.join(', ')}`)
  }
  const seen = new Set()
  for (const [category, files] of Object.entries(CRITICAL_CONTRACT_FILES)) {
    if (!Array.isArray(files) || files.length === 0) errors.push(`${category} has no tests`)
    for (const file of files) {
      if (seen.has(file)) errors.push(`duplicate critical test: ${file}`)
      seen.add(file)
      if (!existsSync(path.join(root, file))) errors.push(`missing critical test: ${file}`)
      if (category === 'migration_guards' ? !file.endsWith('_test.sql') : !/\.test\.(ts|tsx)$/.test(file)) {
        errors.push(`invalid critical test path: ${file}`)
      }
    }
  }
  return errors
}

function run(command, args) {
  process.stdout.write(`\n[critical-contracts] ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

export function main() {
  const errors = validateCriticalContractInventory()
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`[critical-contracts] ${error}\n`)
    process.exit(1)
  }
  const unitFiles = Object.entries(CRITICAL_CONTRACT_FILES)
    .filter(([category]) => category !== 'migration_guards')
    .flatMap(([, files]) => files)
  run('npx', ['vitest', 'run', ...unitFiles])
  run('npm', ['test', '-w', '@posture-ai/engine', '--', '--run'])
  run('npx', ['supabase', 'test', 'db'])
  process.stdout.write('\n[critical-contracts] PASS\n')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main()
