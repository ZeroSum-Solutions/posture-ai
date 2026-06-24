import { z } from 'zod'

// Screening-only vocabulary: these terms must never appear in muscle or
// exercise content. Disclaimers ("not a medical diagnosis") live in UI
// components, not content files, so a blanket ban is safe here.
export const BANNED_TERM_PATTERNS: RegExp[] = [
  /diagnos/i, // diagnose, diagnosis, diagnostic
  /\btreat\w*/i, // treat, treats, treatment, treating
  /\bcure\w*/i,
  /\bpatient\w*/i,
  /\bprescri\w*/i, // prescribe, prescription
]

export const REGIONS = ['head_neck', 'shoulder_girdle', 'trunk', 'hip_pelvis', 'knee_leg'] as const
export type Region = (typeof REGIONS)[number]

export const IMBALANCE_KEYS = [
  'forward_head_posture',
  'anterior_imbalanced_shoulders',
  'posterior_imbalanced_shoulders',
  't1_tilt_backward',
  'pelvic_obliquity',
  'anterior_pelvic_shift',
  'pelvic_axial_rotation',
  'genu_varum_valgum_left',
  'genu_varum_valgum_right',
  'knee_extension_back_knee',
] as const
export type ImbalanceKey = (typeof IMBALANCE_KEYS)[number]

const screeningText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .superRefine((text, ctx) => {
      for (const pattern of BANNED_TERM_PATTERNS) {
        const match = text.match(pattern)
        if (match) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Banned non-screening term "${match[0]}" (pattern ${pattern})`,
          })
        }
      }
    })

export const muscleLinkSchema = z.object({
  imbalanceKey: z.enum(IMBALANCE_KEYS),
  role: z.enum(['tight', 'weak']),
  /** 2-3 sentences tying this muscle to the specific distortion (side/condition nuance lives here). */
  rationale: screeningText(80, 600),
})

export const muscleContentSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case slug'),
  name: z.string().min(3).max(60),
  region: z.enum(REGIONS),
  /** ~120 words, plain-language origin/insertion/position. */
  anatomySummary: screeningText(300, 1200),
  functionText: screeningText(120, 800),
  /** When commonly tight / commonly weak, screening-only framing. */
  screeningNotes: screeningText(120, 800),
  links: z.array(muscleLinkSchema).min(1),
  /** Clinical review gate: unreviewed entries are hidden in the UI. */
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
})
export type MuscleContent = z.infer<typeof muscleContentSchema>

export const exerciseMuscleSchema = z.object({
  muscleSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  role: z.enum(['stretch', 'strengthen']),
  /** 1 = regression, 2 = standard, 3 = progression. */
  progressionLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})

/** Rep band shown to the client (e.g. "10–15 reps"). Null for holds/stretches. */
export const repRangeSchema = z
  .object({
    min: z.number().int().min(1).max(30),
    max: z.number().int().min(1).max(30),
  })
  .refine((r) => r.max >= r.min, { message: 'reps.max must be >= reps.min' })

export const exerciseContentSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().min(3).max(80),
    category: z.enum(['stretch', 'strengthen', 'mobility', 'activation', 'informational']),
    /** Imbalances this exercise is recommended for (drives existing recommendation logic). */
    primaryDeviationKeys: z.array(z.enum(IMBALANCE_KEYS)).min(1),
    minZone: z.enum(['maintain', 'warning', 'danger']),
    instructions: screeningText(80, 800),
    sets: z.number().int().min(1).max(6),
    holdSeconds: z.number().int().min(1).max(120),
    /** Authored hold-vs-dynamic flag — never inferred from holdSeconds. */
    dosageType: z.enum(['hold', 'dynamic']),
    /** Rep band for dynamic work; null for hold/stretch/informational items. */
    reps: repRangeSchema.nullable(),
    /** Compound items pinned last as the Week-3 "Connect" step. */
    isIntegrative: z.boolean().optional(),
    muscles: z.array(exerciseMuscleSchema).min(1),
  })
  .superRefine((ex, ctx) => {
    // reps is null exactly when the item is dosed by time or is a stretch/informational.
    const repsMustBeNull =
      ex.dosageType === 'hold' || ex.category === 'stretch' || ex.category === 'informational'
    if (repsMustBeNull && ex.reps !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reps'],
        message: `reps must be null for a ${ex.dosageType}/${ex.category} item`,
      })
    }
    if (!repsMustBeNull && ex.reps === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reps'],
        message: `reps band is required for a dynamic ${ex.category} item`,
      })
    }
  })
export type ExerciseContent = z.infer<typeof exerciseContentSchema>
