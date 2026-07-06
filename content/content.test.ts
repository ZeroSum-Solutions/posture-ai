import { describe, it, expect } from 'vitest'
import { muscleContentSchema, exerciseContentSchema, muscleLinkSchema, IMBALANCE_KEYS } from './muscles/types'
import { MUSCLE_REGISTRY } from './muscles/registry'
import { ALL_MUSCLES, ALL_EXERCISES } from './index'

const linkKey = (m: string, i: string, r: string) => `${m}|${i}|${r}`

describe('muscle content', () => {
  it('every content file passes the schema (incl. vocabulary lint)', () => {
    for (const muscle of ALL_MUSCLES) {
      const result = muscleContentSchema.safeParse(muscle)
      expect(
        result.success,
        `${muscle.slug}: ${result.success ? '' : JSON.stringify(result.error.issues, null, 1)}`
      ).toBe(true)
    }
  })

  it('content slugs match the registry exactly', () => {
    const contentSlugs = ALL_MUSCLES.map(m => m.slug).sort()
    const registrySlugs = MUSCLE_REGISTRY.map(m => m.slug).sort()
    expect(contentSlugs).toEqual(registrySlugs)
  })

  it('registry name/region agree with content', () => {
    for (const entry of MUSCLE_REGISTRY) {
      const muscle = ALL_MUSCLES.find(m => m.slug === entry.slug)!
      expect(muscle.name, entry.slug).toBe(entry.name)
      expect(muscle.region, entry.slug).toBe(entry.region)
    }
  })

  // No direct EMG evidence supports pectoralis-minor *overactivity* in
  // rounded-shoulder/FHP — only mechanical (length-based) shortening. None of
  // its prose (summary, function, screening, link rationales) may propagate the
  // unsupported activity claim.
  it('pectoralis-minor is coded length-only (no unsupported "overactive" claim)', () => {
    const pecMinor = ALL_MUSCLES.find(m => m.slug === 'pectoralis-minor')
    expect(pecMinor, 'pectoralis-minor content must exist').toBeDefined()
    const prose = [
      pecMinor!.anatomySummary,
      pecMinor!.functionText,
      pecMinor!.screeningNotes,
      ...pecMinor!.links.map(l => l.rationale),
    ].join(' ').toLowerCase()
    expect(prose).not.toContain('overactive')
  })

  // muscleLinkSchema allows [] links, but only for muscles that lost their
  // single link when an unscoreable metric was detached. Any OTHER link-less
  // muscle is a content mistake (a muscle with no imbalance relationship).
  it('only the known unscoreable-metric muscles may have zero imbalance links', () => {
    const ALLOWED_LINKLESS = new Set(['obliques', 'deep-hip-external-rotators'])
    const linkless = ALL_MUSCLES.filter(m => m.links.length === 0).map(m => m.slug)
    for (const slug of linkless) {
      expect(ALLOWED_LINKLESS.has(slug), `${slug} unexpectedly has zero imbalance links`).toBe(true)
    }
  })

  // The research reconciliation graded several inference links by evidence
  // strength. These are the downgrades the confidence field exists to express.
  it('evidence-graded muscle links carry the research confidence grade', () => {
    const linkConf = (slug: string, imbalanceKey: string, role: string) =>
      ALL_MUSCLES.find(m => m.slug === slug)
        ?.links.find(l => l.imbalanceKey === imbalanceKey && l.role === role)?.confidence
    // upper trapezius in FHP: Khan 2020 EMG supports high confidence (Plan 2 lit-sweep)
    expect(linkConf('upper-trapezius', 'forward_head_posture', 'tight')).toBe('high')
    // iliopsoas trunk lean: Sci Rep 2025 RCT confirms gluteal/hamstring inhibition (Plan 2 lit-sweep)
    expect(linkConf('iliopsoas', 'trunk_lean', 'tight')).toBe('high')
    // knee hyperextension: hamstrings stay medium; calf, popliteus, and quadriceps stay low
    expect(linkConf('gastrocnemius-soleus', 'knee_extension_back_knee', 'tight')).toBe('low')
    expect(linkConf('hamstrings', 'knee_extension_back_knee', 'weak')).toBe('medium')
    expect(linkConf('popliteus', 'knee_extension_back_knee', 'weak')).toBe('low')
    expect(linkConf('quadriceps', 'knee_extension_back_knee', 'tight')).toBe('low')
  })

  // Knee hyperextension: hamstrings→weak and calf→tight are the scored links.
  // Popliteus (C+, no causal recurvatum data) and quadriceps (D) stay display-only —
  // kept on their KB pages but excluded from the scored muscle map. See
  // _intake/knee-hyperextension-muscle-evidence.md.
  it('knee-hyperextension keeps only the evidence-backed hamstring and calf links scored', () => {
    const kneeLinks = ALL_MUSCLES.flatMap(m =>
      m.links
        .filter(l => l.imbalanceKey === 'knee_extension_back_knee')
        .map(l => ({ slug: m.slug, role: l.role, scored: l.scored !== false }))
    )
    const scored = kneeLinks.filter(k => k.scored)
    expect(scored).toEqual([
      { slug: 'gastrocnemius-soleus', role: 'tight', scored: true },
      { slug: 'hamstrings', role: 'weak', scored: true },
    ])
    const displayOnly = kneeLinks.filter(k => !k.scored).map(k => k.slug).sort()
    expect(displayOnly).toEqual(['popliteus', 'quadriceps'])
  })

  // Each display-only knee link must carry a screening-safe exclusion_reason
  // explaining why it is kept educational but out of the scored map (surfaced in PR2b).
  it('display-only knee links carry an exclusion_reason', () => {
    const displayOnly = ALL_MUSCLES.flatMap(m =>
      m.links
        .filter(l => l.imbalanceKey === 'knee_extension_back_knee' && l.scored === false)
        .map(l => ({ slug: m.slug, reason: l.exclusionReason }))
    )
    expect(displayOnly.map(d => d.slug).sort()).toEqual(['popliteus', 'quadriceps'])
    for (const d of displayOnly) {
      expect(typeof d.reason === 'string' && d.reason.length > 0, d.slug).toBe(true)
    }
  })

  // Rectus femoris is the one promotion candidate that survived adversarial
  // verification (Reed & Pipe 2021 −1.2° APT after hip-flexor stretch;
  // Nascimento 2020 review) — a medium-confidence hip-flexor link to anterior
  // pelvic tilt, paired with iliopsoas. The other three candidates (tibialis
  // posterior, VMO, vastus lateralis) failed on construct mismatch. See
  // _intake/muscle-promotion-candidates-evidence.md.
  it('rectus femoris is wired to anterior pelvic tilt at medium confidence with a stretch', () => {
    const rf = ALL_MUSCLES.find(m => m.slug === 'rectus-femoris')
    expect(rf, 'rectus-femoris content must exist').toBeDefined()
    const apt = rf!.links.find(
      l => l.imbalanceKey === 'trunk_lean' && l.role === 'tight'
    )
    expect(apt?.confidence).toBe('medium')
    const stretches = ALL_EXERCISES.filter(e =>
      e.muscles.some(m => m.muscleSlug === 'rectus-femoris' && m.role === 'stretch')
    )
    expect(stretches.length, 'rectus-femoris needs >=1 stretch').toBeGreaterThanOrEqual(1)
  })

  // The strongest links — direct primary EMG or a validated clinical sign in the
  // relevant population — carry the 'high' grade (Stage-2 muscle roster).
  it('the strongest-evidenced muscle links carry the high confidence grade', () => {
    const conf = (slug: string, key: string, role: string) =>
      ALL_MUSCLES.find(m => m.slug === slug)
        ?.links.find(l => l.imbalanceKey === key && l.role === role)?.confidence
    expect(conf('sternocleidomastoid', 'forward_head_posture', 'tight')).toBe('high')
    expect(conf('deep-cervical-flexors', 'forward_head_posture', 'weak')).toBe('high')
    expect(conf('pectoralis-minor', 'anterior_imbalanced_shoulders', 'tight')).toBe('high')
    expect(conf('upper-trapezius', 'anterior_imbalanced_shoulders', 'tight')).toBe('high')
    expect(conf('lower-trapezius', 'anterior_imbalanced_shoulders', 'weak')).toBe('high')
    expect(conf('serratus-anterior', 'anterior_imbalanced_shoulders', 'weak')).toBe('high')
    expect(conf('gluteus-medius', 'pelvic_obliquity', 'weak')).toBe('high')
    expect(conf('gluteus-maximus', 'trunk_lean', 'weak')).toBe('high')
    expect(conf('iliopsoas', 'trunk_lean', 'tight')).toBe('high')
    expect(conf('lumbar-erector-spinae', 'trunk_lean', 'tight')).toBe('high')
  })

  it('content links cover the registry links exactly (no missing, no extras)', () => {
    const contentLinks = new Set(
      ALL_MUSCLES.flatMap(m => m.links.map(l => linkKey(m.slug, l.imbalanceKey, l.role)))
    )
    const registryLinks = new Set(
      MUSCLE_REGISTRY.flatMap(m => m.links.map(l => linkKey(m.slug, l.imbalanceKey, l.role)))
    )
    const missing = [...registryLinks].filter(k => !contentLinks.has(k))
    const extra = [...contentLinks].filter(k => !registryLinks.has(k))
    expect(missing, 'links required by registry but absent from content').toEqual([])
    expect(extra, 'links in content but not in the reviewed registry').toEqual([])
  })
})

describe('exercise content', () => {
  it('every exercise passes the schema (incl. vocabulary lint)', () => {
    for (const exercise of ALL_EXERCISES) {
      const result = exerciseContentSchema.safeParse(exercise)
      expect(
        result.success,
        `${exercise.slug}: ${result.success ? '' : JSON.stringify(result.error.issues, null, 1)}`
      ).toBe(true)
    }
  })

  it('exercise slugs are unique', () => {
    const slugs = ALL_EXERCISES.map(e => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('exercise muscle slugs all exist in the registry', () => {
    const known = new Set(MUSCLE_REGISTRY.map(m => m.slug))
    for (const exercise of ALL_EXERCISES) {
      for (const m of exercise.muscles) {
        expect(known.has(m.muscleSlug), `${exercise.slug} -> ${m.muscleSlug}`).toBe(true)
      }
    }
  })

  it('every imbalance key is served by at least one exercise', () => {
    for (const key of IMBALANCE_KEYS) {
      const count = ALL_EXERCISES.filter(e => e.primaryDeviationKeys.includes(key)).length
      expect(count, key).toBeGreaterThanOrEqual(1)
    }
  })

  it('every tight-linked muscle has at least one stretch exercise', () => {
    const tightMuscles = new Set(
      MUSCLE_REGISTRY.filter(m => m.links.some(l => l.role === 'tight')).map(m => m.slug)
    )
    for (const slug of tightMuscles) {
      const stretches = ALL_EXERCISES.filter(e =>
        e.muscles.some(m => m.muscleSlug === slug && m.role === 'stretch')
      )
      expect(stretches.length, `${slug} needs >=1 stretch`).toBeGreaterThanOrEqual(1)
    }
  })

  it('every weak-linked muscle has strengthening work across >=2 progression levels', () => {
    const weakMuscles = new Set(
      MUSCLE_REGISTRY.filter(m => m.links.some(l => l.role === 'weak')).map(m => m.slug)
    )
    for (const slug of weakMuscles) {
      const levels = new Set(
        ALL_EXERCISES.flatMap(e =>
          e.muscles
            .filter(m => m.muscleSlug === slug && m.role === 'strengthen')
            .map(m => m.progressionLevel)
        )
      )
      expect(levels.size, `${slug} needs strengthen work at >=2 progression levels, has [${[...levels]}]`).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps the original ten seed exercises present by slug', () => {
    const seedSlugs = [
      'chin-tucks', 'neck-lateral-stretch', 'thoracic-extension', 'wall-angels',
      'doorway-pec-stretch', 'kneeling-hip-flexor-stretch', 'glute-bridge',
      'clamshell', 'single-leg-balance', 'standing-hamstring-curl',
    ]
    const slugs = new Set(ALL_EXERCISES.map(e => e.slug))
    for (const slug of seedSlugs) expect(slugs.has(slug), slug).toBe(true)
  })

  // Prone hip extension + ADIM brace: glute-max activation that inhibits the
  // lumbar erectors (Oh 2007 ~52% MVIC — from this drill, not the glute bridge).
  it('prone hip extension is wired to APT with glute-max + deep-abdominal activation', () => {
    const ex = ALL_EXERCISES.find(e => e.slug === 'prone-hip-extension')
    expect(ex, 'prone-hip-extension must exist').toBeDefined()
    expect(ex!.category).toBe('strengthen')
    expect(ex!.primaryDeviationKeys).toContain('trunk_lean')
    const slugs = ex!.muscles.map(m => m.muscleSlug)
    expect(slugs).toContain('gluteus-maximus')
    expect(slugs).toContain('deep-abdominals')
  })

  it('total exercise count lands in the planned 45-80 range', () => {
    expect(ALL_EXERCISES.length).toBeGreaterThanOrEqual(45)
    expect(ALL_EXERCISES.length).toBeLessThanOrEqual(80)
  })


  // Static stretches must hold >=30s to produce chronic ROM change (Bandy &
  // Irion 1994 meta-analysis; 2025 Delphi; Grade A). Sub-threshold holds are
  // an under-dose. Isometric strength/stability holds are a different category
  // and are intentionally excluded.
  it('every static stretch holds >= 30 seconds (Bandy & Irion 1994 floor)', () => {
    const stretches = ALL_EXERCISES.filter(e => e.category === 'stretch')
    // Guard against a vacuous pass: the predicate must actually run on real data.
    expect(stretches.length, 'expected static stretches in the library').toBeGreaterThan(0)
    const subThreshold = stretches
      .filter(e => e.holdSeconds < 30)
      .map(e => `${e.slug} (${e.holdSeconds}s)`)
    expect(subThreshold, 'static stretches below the 30s evidence floor').toEqual([])
  })
})

describe('muscle link grading completeness (Plan 2 §4)', () => {
  const ALL_MUSCLE_LINKS = ALL_MUSCLES.flatMap(m => m.links)

  it('every link has a confidence tier and a citation', () => {
    const ungraded = ALL_MUSCLE_LINKS.filter(l => !l.confidence || !l.citation)
    expect(ungraded.map(l => `${l.imbalanceKey}/${l.role}`)).toEqual([])
  })

  it('grade distribution is recorded (guards accidental mass-regrade)', () => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const l of ALL_MUSCLE_LINKS) counts[l.confidence!]++
    expect(counts.high + counts.medium + counts.low).toBe(46)
  })
})

describe('muscle link citation field', () => {
  const ALL_MUSCLE_LINKS = ALL_MUSCLES.flatMap(m => m.links)

  it('citation, when present, passes screening vocabulary', () => {
    for (const link of ALL_MUSCLE_LINKS) {
      if (link.citation) {
        expect(() => muscleLinkSchema.parse(link)).not.toThrow()
        expect(link.citation).not.toMatch(/\b(diagnos|treat|cure|patient|prescri)/i)
      }
    }
  })

  it('schema accepts a citation field', () => {
    const sample = { imbalanceKey: 'trunk_lean', role: 'tight',
      confidence: 'medium', rationale: 'x'.repeat(90),
      citation: 'Kendall 2005, Muscles: Testing and Function (textbook inference).' }
    expect(() => muscleLinkSchema.parse(sample)).not.toThrow()
  })
})
