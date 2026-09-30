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
  'trunk_lean',
  'pelvic_obliquity',
  'pelvic_axial_rotation',
  'genu_varum_valgum_left',
  'genu_varum_valgum_right',
  'knee_extension_back_knee',
] as const
export type ImbalanceKey = (typeof IMBALANCE_KEYS)[number]

/** Keys retired by the engine-2.0 trunk_lean merge. Stored v1.3 findings still
 * carry them, so display maps must keep entries for them forever. */
export const LEGACY_IMBALANCE_KEYS = ['t1_tilt_backward', 'anterior_pelvic_shift'] as const
export type LegacyImbalanceKey = (typeof LEGACY_IMBALANCE_KEYS)[number]

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

/**
 * Runtime screening-vocabulary gate for GENERATED strings (voice cues, player
 * captions, rating copy) — anything user-facing that is assembled in code
 * rather than authored in a schema-validated content file. Returns the text
 * unchanged when clean; throws naming the banned term otherwise, so a
 * non-screening word can never ship silently.
 */
export function assertScreeningText(text: string): string {
  for (const pattern of BANNED_TERM_PATTERNS) {
    const match = text.match(pattern)
    if (match) {
      throw new Error(`Banned non-screening term "${match[0]}" (pattern ${pattern})`)
    }
  }
  return text
}

export const muscleLinkSchema = z.object({
  imbalanceKey: z.enum(IMBALANCE_KEYS),
  role: z.enum(['tight', 'weak']),
  /**
   * Evidence tier for this link. Every scored link is graded (Plan 2 §4);
   * consumed by the map intensity, the possible-involvement tier, and
   * program ranking. high = consistent EMG/RCT/review support;
   * medium = plausible mechanism + partial/indirect evidence;
   * low = textbook inference without corroborating studies.
   */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  /**
   * Whether this link drives the *scored* muscle map. Absent = true (scored).
   * `false` = display-only: the evidence is too weak to present the inference as
   * a confident assessment finding, so it is excluded from the scored seed. Two
   * consumers honor this: the KB seed generator (scripts/generate-muscle-seed.ts)
   * skips these links, and the demotion migration drops their muscle_imbalance_links
   * rows + imbalance_definitions array entries (the two sources the results muscle
   * map reads). The relationship still lives in the muscle's own anatomy/screening
   * prose; a labelled low-confidence visual tier on the map is deferred (Stage-2
   * §4 extended tier). Used to demote inferences the research reconciliation could
   * not support — e.g. the knee-hyperextension quadriceps and popliteus links, which
   * rest on textbook inference with no study tying the muscle's state to recurvatum.
   * No knee link clears an asymptomatic-adult bar: the two scored ones (hamstrings→weak,
   * calf→tight) rest on pediatric cerebral-palsy gait studies and are graded `medium`
   * accordingly. See docs/evidence/muscle-links/knee_extension.md.
   */
  scored: z.boolean().optional(),
  /**
   * Screening-safe note explaining why a display-only (scored:false) link is kept
   * out of the scored muscle map. Authored for the demoted knee links; surfaced in
   * the PR2b results/PDF gate. Absent for scored links.
   */
  exclusionReason: screeningText(20, 300).optional(),
  /** 2-3 sentences tying this muscle to the specific distortion (side/condition nuance lives here). */
  rationale: screeningText(80, 600),
  /**
   * One-line source naming the evidence for this link's grade. A study
   * (author year, journal) for high/medium; the textbook basis
   * (e.g. "Kendall 2005 textbook inference") for low. Screening-gated.
   */
  citation: screeningText(8, 240).optional(),
  /**
   * Structured subject-side nuance for LATERAL findings only — the three keys whose
   * direction is 'Level' | 'Left Low' | 'Right Low' (anterior_imbalanced_shoulders,
   * posterior_imbalanced_shoulders, pelvic_obliquity). 'elevated' = this link applies to
   * the side of the finding that sits higher; 'lowered' = the side that sits lower;
   * 'both' or absent = bilateral (today's behavior; also the default for any other key).
   * For the genu_varum_valgum_left / genu_varum_valgum_right keys the subject side comes
   * from the key suffix itself, so this field is ignored there. Set ONLY when the link's
   * own `rationale` prose explicitly states the side — never inferred.
   */
  side: z.enum(['elevated', 'lowered', 'both']).optional(),
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
  // Most muscles assert >=1 imbalance link, but a few (obliques,
  // deep-hip-external-rotators) are retained purely as exercise-referenced
  // education pages after their only link — pelvic axial rotation — was
  // detached as an unscoreable metric. The registry<->content match test
  // (content.test.ts) is the real guard on which links must exist.
  links: z.array(muscleLinkSchema),
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
    /**
     * Imbalances that make this exercise unsafe even when a primaryDeviationKey
     * also matches. Selection ORs over one priority's keys, so without this an
     * exercise coherent for finding A still reaches a client who also presents
     * finding B. Applied as an exclusion pass over the client's whole finding set.
     */
    contraindicatedDeviationKeys: z.array(z.enum(IMBALANCE_KEYS)).optional(),
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
    /**
     * Workout-player demonstration media (optional, additive — the 55 files
     * adopt clips incrementally; the player falls back to poster/text).
     */
    media: z
      .object({
        loopUrl: z.string().min(1),
        posterUrl: z.string().min(1),
        fallbackGifUrl: z.string().min(1).optional(),
      })
      .optional(),
    /** Short structured coaching cues for the player's voice/captions — never the long instructions. */
    form: z
      .object({
        alignmentCue: screeningText(20, 160),
        avoidCue: screeningText(20, 160),
        tempo: z.string().optional(),
      })
      .optional(),
    /**
     * Discrete coaching steps for the player's Up-Next step list and detail
     * surfaces — always our own wording (third-party dataset text is
     * reference only, never copied).
     */
    steps: z.array(screeningText(20, 160)).min(2).max(8).optional(),
    /** Player rest between sets; absent → the player's per-category default. */
    restSecondsBetweenSets: z.number().int().min(0).max(120).optional(),
  })
  .superRefine((ex, ctx) => {
    // A key cannot be both an indication and a contraindication for the same exercise.
    const conflicting = (ex.contraindicatedDeviationKeys ?? []).filter((k) =>
      (ex.primaryDeviationKeys as readonly string[]).includes(k),
    )
    if (conflicting.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contraindicatedDeviationKeys'],
        message: `key is both indicated and contraindicated: ${conflicting.join(', ')}`,
      })
    }
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
