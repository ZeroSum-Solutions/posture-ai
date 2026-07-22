import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ALL_EXERCISES, ALL_MUSCLES } from '@/content'
import { BILATERAL_KNEE_COPY, IMBALANCE_COPY } from '@/content/report/imbalance-copy'
import { clinicalContraindicationId, clinicalLinkId, type ClinicalInventory } from './policy'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

export function stableClinicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function clinicalSha256(value: unknown): string {
  return createHash('sha256').update(stableClinicalJson(value)).digest('hex')
}

export function buildClinicalContentInventory(): ClinicalInventory {
  const muscles = ALL_MUSCLES.map((muscle) => ({
    id: `muscle:${muscle.slug}`,
    kind: 'muscle' as const,
    slug: muscle.slug,
    sha256: clinicalSha256({ kind: 'muscle', content: muscle }),
  }))
  const exercises = ALL_EXERCISES.map((exercise) => ({
    id: `exercise:${exercise.slug}`,
    kind: 'exercise' as const,
    slug: exercise.slug,
    sha256: clinicalSha256({ kind: 'exercise', content: exercise }),
  }))
  const links = ALL_MUSCLES.flatMap((muscle) => muscle.links.map((link) => ({
    id: clinicalLinkId(muscle.slug, link.imbalanceKey, link.role),
    kind: 'link' as const,
    slug: muscle.slug,
    sha256: clinicalSha256({ kind: 'link', muscleSlug: muscle.slug, content: link }),
  })))
  const exerciseMuscles = ALL_EXERCISES.flatMap((exercise) => exercise.muscles.map((muscle) => ({
    id: `exercise_muscle:${exercise.slug}:${muscle.muscleSlug}:${muscle.role}:${muscle.progressionLevel}`,
    kind: 'exercise_muscle' as const,
    slug: exercise.slug,
    sha256: clinicalSha256({ kind: 'exercise_muscle', exerciseSlug: exercise.slug, content: muscle }),
  })))
  const contraindications = ALL_EXERCISES.flatMap((exercise) =>
    (exercise.contraindicatedDeviationKeys ?? []).map((imbalanceKey) => ({
      id: clinicalContraindicationId(exercise.slug, imbalanceKey),
      kind: 'contraindication' as const,
      slug: exercise.slug,
      sha256: clinicalSha256({ kind: 'contraindication', exerciseSlug: exercise.slug, imbalanceKey }),
    })),
  )
  const reportCopy = [
    ...Object.entries(IMBALANCE_COPY),
    ['bilateral-knee', BILATERAL_KNEE_COPY] as const,
  ].map(([key, copy]) => ({
    id: `report_copy:${key}`,
    kind: 'report_copy' as const,
    slug: key,
    sha256: clinicalSha256({ kind: 'report_copy', key, content: copy }),
  }))
  const algorithmSourcePaths = [
    'lib/program/dosage.ts',
    'lib/program/selectPriorities.ts',
    'lib/program/roleCoherence.ts',
    'lib/program/evidenceWeight.ts',
    'lib/program/buildProgram.ts',
    'lib/program/clinicalProjection.ts',
    'lib/clinical-content/policy.ts',
    'lib/clinical-content/runtime.ts',
    'lib/clinical-content/catalog.ts',
    'lib/clinical-content/database.ts',
    'lib/clinical-content/http.ts',
    'lib/findings/storedFindingToEngine.ts',
    'lib/reports/clientProgram.ts',
    'lib/reports/clientComparison.ts',
    'lib/comparison/policy.ts',
    'lib/scoring/grade-display.ts',
    'lib/exercises.ts',
    'lib/pdf/report.tsx',
    'lib/pdf/clientReport.tsx',
    'lib/workout/generateWorkoutSession.ts',
    'lib/workout/buildSessionFromAssessment.ts',
    'lib/workout/tokenProjection.ts',
    'lib/workout/cues.ts',
    'content/muscles/types.ts',
    'packages/posture-engine/src/engine.ts',
    'packages/posture-engine/src/thresholds.ts',
    'app/assessments/[id]/PriorityProgram.tsx',
    'app/assessments/[id]/page.tsx',
    'app/assessments/[id]/ClinicalAssessmentResults.tsx',
    'app/assessments/[id]/ExerciseDetailSheet.tsx',
    'app/assessments/[id]/WhyThisSheet.tsx',
    'app/assessments/[id]/MuscleBodyMap.tsx',
    'app/assessments/[id]/findingsToMuscleStates.ts',
    'app/assessments/[id]/muscleMap.ts',
    'app/exercises/ExercisesLibrary.tsx',
    'app/exercises/page.tsx',
    'app/muscles/MuscleLibrary.tsx',
    'app/muscles/page.tsx',
    'app/muscles/[slug]/page.tsx',
    'app/workouts/_player/WorkoutPlayer.tsx',
    'app/workouts/[sessionId]/page.tsx',
    'app/s/[token]/ShareTokenClient.tsx',
    'app/s/[token]/page.tsx',
    'app/layout.tsx',
    'components/AppShell.tsx',
    'components/NavBar.tsx',
    'proxy.ts',
    'app/api/assessments/[id]/route.ts',
    'app/api/clinical-content/exercises/[slug]/route.ts',
    'app/api/clinical-content/findings/[key]/muscles/route.ts',
    'app/api/reports/route.ts',
    'app/api/reports/[id]/download/route.ts',
    'app/api/workouts/route.ts',
    'app/api/workouts/[id]/run/route.ts',
    'app/api/workouts/[id]/rate/route.ts',
    'app/api/workouts/shares/route.ts',
    'app/api/workouts/token/[token]/route.ts',
    'app/api/workouts/token/[token]/rate/route.ts',
  ]
  const algorithms = [{
    id: 'algorithm:recommendation-engine',
    kind: 'algorithm' as const,
    slug: 'recommendation-engine-v1',
    sha256: clinicalSha256({
      kind: 'algorithm',
      version: 'recommendation-engine-v1',
      sourceFiles: algorithmSourcePaths.map((path) => ({
        path,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      })),
    }),
  }]
  const items = [...muscles, ...exercises, ...links, ...exerciseMuscles, ...contraindications, ...reportCopy, ...algorithms]
    .sort((a, b) => a.id.localeCompare(b.id))
  const counts = {
    muscles: muscles.length,
    exercises: exercises.length,
    links: links.length,
    exercise_muscles: exerciseMuscles.length,
    contraindications: contraindications.length,
    report_copy: reportCopy.length,
    algorithms: algorithms.length,
  }
  const inventoryBase = {
    schema_version: 1 as const,
    inventory_version: 'clinical-content-inventory-v1',
    counts,
    items,
  }
  return {
    ...inventoryBase,
    inventory_sha256: clinicalSha256(inventoryBase),
  }
}
