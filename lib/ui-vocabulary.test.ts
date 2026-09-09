import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Screening-vocabulary sweep over UI source copy (roadmap P5): the same
// banned stems as the content lint, applied to everything a user can read
// in the app and the PDF. Negation disclaimers ("not a medical diagnosis",
// "Non-Diagnostic") are the one allowed use of the diagnosis stem.

const ROOTS = ['app', 'components', 'lib/pdf', 'lib/capture']
// Sanctioned disclaimer phrasings and schema identifiers — the only places
// a banned stem may legitimately appear.
const SANCTIONED = [
  /non[-_]?diagnostic/i, // disclaimers + the non_diagnostic_ack_at column
  /not a (medical )?diagnos/i,
  /do not constitute medical advice, diagnosis, or treatment/i,
  /never normal\/abnormal\/diagnosis/i, // onboarding instruction about language
]
const TRAINING_PRESCRIPTION_FILES = [
  'app/api/training/sessions/[sessionId]/start/route.ts',
  'app/workouts/_strength/PracticeDraftPanel.tsx',
  'app/workouts/_strength/TrainingSessionPlayer.gateway.ts',
  'app/workouts/_strength/TrainingSessionPlayer.tsx',
  'app/train/privacy/TrainingSubjectErasure.tsx',
  'app/workouts/_strength/TrainingExerciseSwapPanel.tsx',
  'app/workouts/_strength/TrainingPreviousPerformance.tsx',
  'app/workouts/_strength/TrainingProgramWorkspace.tsx',
] as const
const BANNED: ReadonlyArray<{
  stem: RegExp
  allow: readonly RegExp[]
  allowFiles?: readonly string[]
}> = [
  { stem: /diagnos/i, allow: SANCTIONED },
  { stem: /\btreat\w*/i, allow: [SANCTIONED[2]] },
  { stem: /\bcure\w*/i, allow: [] as RegExp[] },
  { stem: /\bpatient\w*/i, allow: [] as RegExp[] },
  { stem: /\bprescri\w*/i, allow: [] as RegExp[], allowFiles: TRAINING_PRESCRIPTION_FILES },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test(?:-fixtures)?\./.test(entry)) yield full
  }
}

// Only lint human-readable string content, not identifiers: extract string
// literals and JSX text. Cheap approximation: check lines, ignore imports.
function lintLine(path: string, line: string, lineNumber: number): string[] {
  const violations: string[] = []
  if (/^\s*(import|export \{)/.test(line)) return violations
  for (const { stem, allow, allowFiles } of BANNED) {
    const match = line.match(stem)
    if (!match) continue
    if (allow.some(rx => rx.test(line))) continue
    if (allowFiles?.some(file => path === file || path.endsWith(`/${file}`))) continue
    violations.push(`${path}:${lineNumber} "${match[0]}" -> ${line.trim().slice(0, 90)}`)
  }
  return violations
}

function lintFile(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').flatMap((line, index) => lintLine(path, line, index + 1))
}

describe('UI copy screening-vocabulary sweep', () => {
  it.each(TRAINING_PRESCRIPTION_FILES)('allows prescribed-versus-actual training vocabulary in %s', path => {
    expect(lintLine(
      path,
      '<p>Prescribed: 2 kg · Actual: 2.5 kg</p>',
      1,
    )).toEqual([])
  })

  it('keeps prescription language forbidden in screening UI', () => {
    expect(lintLine(
      'app/assessments/[id]/page.tsx',
      '<p>Your screening prescription is ready.</p>',
      1,
    )).toHaveLength(1)
  })

  it.each([
    '<p>This scan diagnoses weakness.</p>',
    '<p>This training plan treats an injury.</p>',
  ])('keeps diagnostic and treatment claims forbidden: %s', source => {
    expect(lintLine(
      'app/workouts/_strength/TrainingSessionPlayer.tsx',
      source,
      1,
    )).toHaveLength(1)
  })

  it('app, components, and PDF copy contain no diagnostic vocabulary', () => {
    const violations: string[] = []
    for (const root of ROOTS) {
      for (const file of walk(root)) violations.push(...lintFile(file))
    }
    expect(violations, `\n${violations.join('\n')}`).toEqual([])
  })
})
