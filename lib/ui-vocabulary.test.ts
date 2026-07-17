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
const BANNED = [
  { stem: /diagnos/i, allow: SANCTIONED },
  { stem: /\btreat\w*/i, allow: [SANCTIONED[2]] },
  { stem: /\bcure\w*/i, allow: [] as RegExp[] },
  { stem: /\bpatient\w*/i, allow: [] as RegExp[] },
  { stem: /\bprescri\w*/i, allow: [] as RegExp[] },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(tsx|ts)$/.test(entry) && !/\.test\./.test(entry)) yield full
  }
}

// Only lint human-readable string content, not identifiers: extract string
// literals and JSX text. Cheap approximation: check lines, ignore imports.
function lintFile(path: string): string[] {
  const violations: string[] = []
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*(import|export \{)/.test(line)) return
    for (const { stem, allow } of BANNED) {
      const match = line.match(stem)
      if (!match) continue
      if (allow.some(rx => rx.test(line))) continue
      violations.push(`${path}:${i + 1} "${match[0]}" -> ${line.trim().slice(0, 90)}`)
    }
  })
  return violations
}

describe('UI copy screening-vocabulary sweep', () => {
  it('app, components, and PDF copy contain no diagnostic vocabulary', () => {
    const violations: string[] = []
    for (const root of ROOTS) {
      for (const file of walk(root)) violations.push(...lintFile(file))
    }
    expect(violations, `\n${violations.join('\n')}`).toEqual([])
  })
})
