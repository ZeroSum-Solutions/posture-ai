import type { ImbalanceKey, Region } from './types'

// Canonical muscle registry — the single source of truth for slugs, regions
// and which (imbalance, role) links each muscle must document. Derived from
// the seed tight/weak strings via docs/plans/2026-06-12-p4a-muscle-slug-mapping.md.
// Content files must cover exactly these links (content.test.ts enforces it).

export interface RegistryEntry {
  slug: string
  name: string
  region: Region
  links: { imbalanceKey: ImbalanceKey; role: 'tight' | 'weak' }[]
}

export const MUSCLE_REGISTRY: RegistryEntry[] = [
  // ---- head/neck ----
  {
    slug: 'suboccipitals',
    name: 'Suboccipitals',
    region: 'head_neck',
    links: [{ imbalanceKey: 'forward_head_posture', role: 'tight' }],
  },
  {
    slug: 'upper-trapezius',
    name: 'Upper Trapezius',
    region: 'head_neck',
    links: [
      { imbalanceKey: 'forward_head_posture', role: 'tight' },
      { imbalanceKey: 'anterior_imbalanced_shoulders', role: 'tight' },
      { imbalanceKey: 'posterior_imbalanced_shoulders', role: 'tight' },
    ],
  },
  {
    slug: 'levator-scapulae',
    name: 'Levator Scapulae',
    region: 'head_neck',
    links: [
      { imbalanceKey: 'forward_head_posture', role: 'tight' },
      { imbalanceKey: 'posterior_imbalanced_shoulders', role: 'tight' },
    ],
  },
  {
    slug: 'sternocleidomastoid',
    name: 'Sternocleidomastoid',
    region: 'head_neck',
    links: [{ imbalanceKey: 'forward_head_posture', role: 'tight' }],
  },
  {
    slug: 'deep-cervical-flexors',
    name: 'Deep Cervical Flexors',
    region: 'head_neck',
    links: [{ imbalanceKey: 'forward_head_posture', role: 'weak' }],
  },
  {
    slug: 'middle-trapezius',
    name: 'Middle Trapezius',
    region: 'head_neck',
    links: [
      { imbalanceKey: 'anterior_imbalanced_shoulders', role: 'weak' },
      { imbalanceKey: 'posterior_imbalanced_shoulders', role: 'weak' },
    ],
  },
  {
    slug: 'lower-trapezius',
    name: 'Lower Trapezius',
    region: 'head_neck',
    links: [
      { imbalanceKey: 'forward_head_posture', role: 'weak' },
      { imbalanceKey: 'anterior_imbalanced_shoulders', role: 'weak' },
      { imbalanceKey: 'posterior_imbalanced_shoulders', role: 'weak' },
    ],
  },
  // ---- shoulder girdle ----
  {
    slug: 'pectoralis-major',
    name: 'Pectoralis Major',
    region: 'shoulder_girdle',
    links: [{ imbalanceKey: 'anterior_imbalanced_shoulders', role: 'tight' }],
  },
  {
    slug: 'pectoralis-minor',
    name: 'Pectoralis Minor',
    region: 'shoulder_girdle',
    links: [
      { imbalanceKey: 'anterior_imbalanced_shoulders', role: 'tight' },
      { imbalanceKey: 'forward_head_posture', role: 'tight' },
    ],
  },
  {
    slug: 'anterior-deltoid',
    name: 'Anterior Deltoid',
    region: 'shoulder_girdle',
    links: [{ imbalanceKey: 'anterior_imbalanced_shoulders', role: 'tight' }],
  },
  {
    slug: 'rhomboids',
    name: 'Rhomboids',
    region: 'shoulder_girdle',
    links: [
      { imbalanceKey: 'anterior_imbalanced_shoulders', role: 'weak' },
      { imbalanceKey: 'posterior_imbalanced_shoulders', role: 'weak' },
    ],
  },
  {
    slug: 'serratus-anterior',
    name: 'Serratus Anterior',
    region: 'shoulder_girdle',
    links: [{ imbalanceKey: 'anterior_imbalanced_shoulders', role: 'weak' }],
  },
  // ---- trunk ----
  {
    slug: 'thoracic-erector-spinae',
    name: 'Thoracic Erector Spinae',
    region: 'trunk',
    links: [
      { imbalanceKey: 'trunk_lean', role: 'weak' },
      { imbalanceKey: 'forward_head_posture', role: 'weak' },
    ],
  },
  {
    slug: 'lumbar-erector-spinae',
    name: 'Lumbar Erector Spinae',
    region: 'trunk',
    links: [{ imbalanceKey: 'trunk_lean', role: 'tight' }],
  },
  {
    slug: 'latissimus-dorsi',
    name: 'Latissimus Dorsi',
    region: 'trunk',
    links: [{ imbalanceKey: 'trunk_lean', role: 'tight' }],
  },
  {
    slug: 'deep-abdominals',
    name: 'Abdominal Wall (Rectus + Transversus)',
    region: 'trunk',
    links: [{ imbalanceKey: 'trunk_lean', role: 'weak' }],
  },
  {
    slug: 'obliques',
    name: 'Internal & External Obliques',
    region: 'trunk',
    // pelvic_axial_rotation links detached — unscoreable transverse-plane metric.
    links: [],
  },
  {
    slug: 'quadratus-lumborum',
    name: 'Quadratus Lumborum',
    region: 'trunk',
    links: [{ imbalanceKey: 'pelvic_obliquity', role: 'tight' }],
  },
  // ---- hip/pelvis ----
  {
    slug: 'iliopsoas',
    name: 'Iliopsoas (Hip Flexors)',
    region: 'hip_pelvis',
    links: [{ imbalanceKey: 'trunk_lean', role: 'tight' }],
  },
  {
    slug: 'rectus-femoris',
    name: 'Rectus Femoris',
    region: 'hip_pelvis',
    links: [{ imbalanceKey: 'trunk_lean', role: 'tight' }],
  },
  {
    slug: 'gluteus-maximus',
    name: 'Gluteus Maximus',
    region: 'hip_pelvis',
    // pelvic_axial_rotation link detached — unscoreable transverse-plane metric.
    links: [
      { imbalanceKey: 'trunk_lean', role: 'weak' },
    ],
  },
  {
    slug: 'gluteus-medius',
    name: 'Gluteus Medius',
    region: 'hip_pelvis',
    links: [
      { imbalanceKey: 'pelvic_obliquity', role: 'tight' },
      { imbalanceKey: 'pelvic_obliquity', role: 'weak' },
      { imbalanceKey: 'genu_varum_valgum_left', role: 'weak' },
      { imbalanceKey: 'genu_varum_valgum_right', role: 'weak' },
    ],
  },
  {
    slug: 'hip-adductors',
    name: 'Hip Adductors',
    region: 'hip_pelvis',
    links: [
      { imbalanceKey: 'pelvic_obliquity', role: 'tight' },
      { imbalanceKey: 'genu_varum_valgum_left', role: 'tight' },
      { imbalanceKey: 'genu_varum_valgum_right', role: 'tight' },
    ],
  },
  {
    slug: 'deep-hip-external-rotators',
    name: 'Deep Hip External Rotators (Piriformis Group)',
    region: 'hip_pelvis',
    // pelvic_axial_rotation link detached — unscoreable transverse-plane metric.
    links: [],
  },
  {
    slug: 'tfl-it-band',
    name: 'TFL & IT Band',
    region: 'hip_pelvis',
    links: [
      { imbalanceKey: 'genu_varum_valgum_left', role: 'tight' },
      { imbalanceKey: 'genu_varum_valgum_right', role: 'tight' },
    ],
  },
  // ---- knee/leg ----
  {
    slug: 'quadriceps',
    name: 'Quadriceps (incl. VMO)',
    region: 'knee_leg',
    links: [
      { imbalanceKey: 'knee_extension_back_knee', role: 'tight' },
      { imbalanceKey: 'genu_varum_valgum_left', role: 'weak' },
      { imbalanceKey: 'genu_varum_valgum_right', role: 'weak' },
    ],
  },
  {
    slug: 'hamstrings',
    name: 'Hamstrings',
    region: 'knee_leg',
    links: [
      { imbalanceKey: 'trunk_lean', role: 'weak' },
      { imbalanceKey: 'knee_extension_back_knee', role: 'weak' },
    ],
  },
  {
    slug: 'popliteus',
    name: 'Popliteus',
    region: 'knee_leg',
    links: [{ imbalanceKey: 'knee_extension_back_knee', role: 'weak' }],
  },
  {
    slug: 'gastrocnemius-soleus',
    name: 'Gastrocnemius & Soleus',
    region: 'knee_leg',
    links: [
      { imbalanceKey: 'trunk_lean', role: 'tight' },
      { imbalanceKey: 'knee_extension_back_knee', role: 'tight' },
    ],
  },
]
