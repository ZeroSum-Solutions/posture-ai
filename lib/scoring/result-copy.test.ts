// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RESULT_SURFACES = [
  'app/assessments/[id]/page.tsx',
  'app/assessments/[id]/GradeSummary.tsx',
  'lib/pdf/report.tsx',
  'app/api/assessments/[id]/route.ts',
  'app/api/assessments/[id]/status/route.ts',
  'app/api/reports/route.ts',
] as const

const BANNED_PATTERNS = [
  /\belite\b/i,
  /\bcritical\b/i,
  /\bpercentile\b/i,
  /\branks?\b/i,
  /\btop\s+\d+%/i,
  /\bmodeled[- ]population\b/i,
] as const

const GRADE_DERIVED_COPY_SURFACES = [
  'lib/program/buildProgram.ts',
  'lib/pdf/clientReport.tsx',
  'app/assessments/[id]/PriorityProgram.tsx',
] as const

const BANNED_GRADE_JUDGMENTS = [
  /looking great/i,
  /strong baseline/i,
  /solid baseline/i,
  /overall quality/i,
] as const

describe('selected-release result copy', () => {
  it.each(RESULT_SURFACES)('%s contains no unsupported population or quality framing', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const pattern of BANNED_PATTERNS) expect(source).not.toMatch(pattern)
  })

  it.each(GRADE_DERIVED_COPY_SURFACES)('%s contains no grade-derived quality judgment', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const pattern of BANNED_GRADE_JUDGMENTS) expect(source).not.toMatch(pattern)
  })
})
