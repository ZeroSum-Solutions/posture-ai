import { BANNED_TERM_PATTERNS, type ImbalanceKey, type LegacyImbalanceKey } from '../muscles/types'

/**
 * Plain-language, client-facing copy for each imbalance key. Screening-only
 * vocabulary (no diagnose/treat/patient/cure). ~6th–8th grade reading level.
 * Used by the client report's Top-3 Priority Focus cards.
 */
export interface ImbalanceCopy {
  plainLabel: string
  whatItMeans: string
  whatItCanFeel: string
  whatBetterLooksLike: string
  reassurance: string
}

export const IMBALANCE_COPY: Record<ImbalanceKey | LegacyImbalanceKey, ImbalanceCopy> = {
  forward_head_posture: {
    plainLabel: 'Forward Head Posture',
    whatItMeans:
      'Your head tends to sit forward of your shoulders instead of stacked over them — very common with desk and phone time.',
    whatItCanFeel: 'Neck and upper-shoulder tightness, often worse later in the day.',
    whatBetterLooksLike: 'Your head sits more easily over your shoulders, with less end-of-day neck tension.',
    reassurance: 'This is one of the most common things we see, and it usually responds well to a few simple daily movements.',
  },
  anterior_imbalanced_shoulders: {
    plainLabel: 'Rounded Shoulders',
    whatItMeans: 'Your shoulders tend to roll forward, often from lots of reaching, typing, or driving.',
    whatItCanFeel: 'A tight chest, a sense of slouching, and upper-back fatigue.',
    whatBetterLooksLike: 'Your shoulders sit back more naturally and your chest feels more open.',
    reassurance: 'Opening the chest and waking up the mid-back muscles tends to change this quickly.',
  },
  posterior_imbalanced_shoulders: {
    plainLabel: 'Uneven Shoulders',
    whatItMeans: 'One shoulder tends to sit higher or further back than the other.',
    whatItCanFeel: 'One-sided neck or shoulder tightness.',
    whatBetterLooksLike: 'Your shoulders look and feel more even from side to side.',
    reassurance: 'Small side-to-side differences are normal; gentle balancing work helps even them out.',
  },
  trunk_lean: {
    plainLabel: 'Trunk Lean',
    whatItMeans:
      'Your upper body tends to lean forward or backward of your hips instead of stacking straight over them.',
    whatItCanFeel: 'Lower-back or mid-back fatigue after standing, and a sense of working to stay upright.',
    whatBetterLooksLike: 'Your shoulders stack more easily over your hips, so standing tall takes less effort.',
    reassurance: 'Trunk lean is very common and tends to respond well to a mix of core wake-up work and hip mobility.',
  },
  // Legacy entries — keys retired by engine 2.0. Kept forever so stored v1.3
  // findings (which carry these keys) render correctly in the client report.
  t1_tilt_backward: {
    plainLabel: 'Upper-Back Rounding',
    whatItMeans: 'The base of your neck and upper back tends to round or tip backward.',
    whatItCanFeel: 'Stiffness across the upper back.',
    whatBetterLooksLike: 'You can sit and stand taller with less upper-back stiffness.',
    reassurance: 'Upper-back mobility responds well to consistent, gentle movement.',
  },
  pelvic_obliquity: {
    plainLabel: 'Uneven Hips',
    whatItMeans: 'One hip tends to sit higher than the other.',
    whatItCanFeel: 'Uneven standing and occasional one-sided low-back or hip tightness.',
    whatBetterLooksLike: 'Your hips feel more level and your stance more balanced.',
    reassurance: 'This often evens out as the supporting hip muscles get stronger and more balanced.',
  },
  anterior_pelvic_shift: {
    plainLabel: 'Forward Hip Position',
    whatItMeans: 'Your hips tend to push forward or tip, often from sitting a lot and tight hip flexors.',
    whatItCanFeel: 'Low-back tightness and a sense of standing in front of your feet.',
    whatBetterLooksLike: 'Your hips stack more under you and your low back feels more relaxed.',
    reassurance: 'Loosening the hip flexors and waking up the glutes and core tends to help noticeably.',
  },
  pelvic_axial_rotation: {
    plainLabel: 'Pelvic Rotation',
    whatItMeans: 'Your pelvis tends to turn slightly toward one side.',
    whatItCanFeel: 'A sense of being twisted, or one-sided tightness.',
    whatBetterLooksLike: 'Your hips face more squarely forward.',
    reassurance: 'Steady, balanced core work usually brings this back toward center.',
  },
  genu_varum_valgum_left: {
    plainLabel: 'Left Knee Alignment',
    whatItMeans: 'Your left knee tends to track inward or outward rather than over your foot.',
    whatItCanFeel: 'Occasional knee or outer-hip tightness with activity.',
    whatBetterLooksLike: 'Your knee tracks more in line with your foot when you move.',
    reassurance: 'Strengthening the hips and improving balance helps the knee track better.',
  },
  genu_varum_valgum_right: {
    plainLabel: 'Right Knee Alignment',
    whatItMeans: 'Your right knee tends to track inward or outward rather than over your foot.',
    whatItCanFeel: 'Occasional knee or outer-hip tightness with activity.',
    whatBetterLooksLike: 'Your knee tracks more in line with your foot when you move.',
    reassurance: 'Strengthening the hips and improving balance helps the knee track better.',
  },
  knee_extension_back_knee: {
    plainLabel: 'Knee Hyperextension',
    whatItMeans: 'Your knees tend to push back past straight when standing.',
    whatItCanFeel: 'A locked-out feeling or tightness behind the knee.',
    whatBetterLooksLike: 'You stand with a soft, supported knee rather than locking back.',
    reassurance: 'Learning to stack the joint and building support around it helps quickly.',
  },
}

/** Copy shown when both knees collapse into one bilateral priority. */
export const BILATERAL_KNEE_COPY: ImbalanceCopy = {
  plainLabel: 'Knee Alignment (both legs)',
  whatItMeans: 'Both knees tend to track inward or outward rather than over your feet.',
  whatItCanFeel: 'Occasional knee or outer-hip tightness with activity.',
  whatBetterLooksLike: 'Your knees track more in line with your feet when you move.',
  reassurance: 'Strengthening the hips and improving balance helps both knees track better.',
}

// Dev-time guard: keep this copy inside screening vocabulary.
if (process.env.NODE_ENV !== 'production') {
  const all = [...Object.values(IMBALANCE_COPY), BILATERAL_KNEE_COPY]
  for (const c of all) {
    const text = `${c.plainLabel} ${c.whatItMeans} ${c.whatItCanFeel} ${c.whatBetterLooksLike} ${c.reassurance}`
    for (const pattern of BANNED_TERM_PATTERNS) {
      const m = text.match(pattern)
      if (m) throw new Error(`imbalance-copy: banned non-screening term "${m[0]}" in "${c.plainLabel}"`)
    }
  }
}
