import { z } from 'zod'
import snapshotJson from '../../../content/training/library/wger-english-2026-09-08.json'

const plainFieldSchema = z.string().trim().min(1).max(160)
  .refine(value => !/[<>\u0000-\u001f\u007f]/.test(value), 'Reference metadata must be plain text')
const licenseSchema = z.discriminatedUnion('shortName', [
  z.object({
    shortName: z.literal('CC-BY-SA 3'),
    url: z.literal('https://creativecommons.org/licenses/by-sa/3.0/deed.en'),
  }).strict(),
  z.object({
    shortName: z.literal('CC-BY-SA 4'),
    url: z.literal('https://creativecommons.org/licenses/by-sa/4.0/deed.en'),
  }).strict(),
])
const sourceRecordSchema = z.object({
  id: z.string().regex(/^wger:[0-9a-f-]{36}$/),
  normalizedName: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?: [a-z0-9]+)*$/),
  name: plainFieldSchema,
  category: z.enum(['abs', 'arms', 'back', 'calves', 'cardio', 'chest', 'legs', 'shoulders']),
  equipment: z.array(plainFieldSchema).max(20),
  primaryMuscles: z.array(plainFieldSchema).max(20),
  secondaryMuscles: z.array(plainFieldSchema).max(20),
  instructions: z.string().trim().min(80).max(4_000)
    .refine(value => !/<[^>]+>|https?:\/\//i.test(value), 'Reference instructions must be sanitized plain text')
    .refine(
      value => !/\b(?:diagnos\w*|treat\w*|cure\w*|patient\w*|prescri\w*)\b/i.test(value),
      'Reference instructions must use the application screening vocabulary',
    ),
  source: z.object({
    provider: z.literal('wger'),
    recordId: z.number().int().positive(),
    recordUuid: z.string().uuid(),
    translationId: z.number().int().positive(),
    recordUpdatedAt: z.string().datetime({ offset: true }),
    recordUrl: z.string().regex(/^https:\/\/wger\.de\/api\/v2\/exerciseinfo\/\d+\/$/),
    author: plainFieldSchema,
    license: licenseSchema,
  }).strict(),
}).strict()

const snapshotSchema = z.object({
  schemaVersion: z.literal('training-reference-library.v1'),
  snapshotId: z.literal('wger-english-2026-09-08'),
  source: z.object({
    provider: z.literal('wger'),
    endpoint: z.literal('https://wger.de/api/v2/exerciseinfo/?language=2&limit=1000'),
    languageId: z.literal(2),
    capturedAt: z.string().datetime({ offset: true }),
    selectionPolicy: z.literal('english-attributed-cc-by-sa-sanitized-instructions-balanced.v1'),
  }).strict(),
  records: z.array(sourceRecordSchema).min(250).max(2_000),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>()
  const names = new Set<string>()
  snapshot.records.forEach((record, index) => {
    if (ids.has(record.id)) {
      ctx.addIssue({ code: 'custom', message: 'Reference IDs must be unique', path: ['records', index, 'id'] })
    }
    if (names.has(record.normalizedName)) {
      ctx.addIssue({ code: 'custom', message: 'Normalized exercise names must be unique', path: ['records', index, 'normalizedName'] })
    }
    ids.add(record.id)
    names.add(record.normalizedName)
  })
})

type SourceRecord = z.infer<typeof sourceRecordSchema>

export type ReferenceExerciseV1 = SourceRecord & {
  readonly reviewStatus: 'reference_unreviewed'
  readonly compilerEligible: false
  readonly media: null
  readonly searchText: string
}

export interface ReferenceExerciseFilter {
  readonly query: string
  readonly category: string
  readonly equipment: string
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const parsedSnapshot = snapshotSchema.parse(snapshotJson)

export const REFERENCE_EXERCISE_LIBRARY_SOURCE = deepFreeze(parsedSnapshot.source)

export const REFERENCE_EXERCISE_LIBRARY: readonly ReferenceExerciseV1[] = deepFreeze(
  parsedSnapshot.records.map(record => ({
    ...record,
    reviewStatus: 'reference_unreviewed' as const,
    compilerEligible: false as const,
    media: null,
    searchText: [
      record.normalizedName,
      record.category,
      ...record.equipment,
      ...record.primaryMuscles,
      ...record.secondaryMuscles,
    ].join(' ').toLocaleLowerCase('en-US'),
  })),
)

export function filterReferenceExercises(
  exercises: readonly ReferenceExerciseV1[],
  filter: ReferenceExerciseFilter,
): readonly ReferenceExerciseV1[] {
  const query = filter.query.trim().toLocaleLowerCase('en-US')
  return exercises.filter(exercise => (
    (query.length === 0 || exercise.searchText.includes(query))
    && (filter.category === 'all' || exercise.category === filter.category)
    && (filter.equipment === 'all' || exercise.equipment.includes(filter.equipment))
  ))
}
