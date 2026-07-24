export const TIER_B_PROTOCOL_VERSION = 'tier-b-four-view-repositioned-v2' as const
export const TIER_B_ANALYSIS_VERSION = 'tierb-agreement-bootstrap-v1' as const
export const TIER_B_PUBLIC_ENVELOPE_VERSION = 'tierb-public-envelope-v1' as const
export const TIER_B_RESTRICTED_ENVELOPE_VERSION = 'tierb-restricted-envelope-v1' as const
export const TIER_B_TRUST_POLICY_VERSION = 'tierb-trust-policy-v1' as const

export const TIER_B_VIEWS = ['front', 'side_left', 'back', 'side_right'] as const
export const TIER_B_REPEAT_IDS = [1, 2, 3] as const
export const TIER_B_CAPTURE_SLOTS = [
  {
    key: 'front',
    label: 'Front',
    engineView: 'front',
    profileSide: null,
  },
  {
    key: 'side_left',
    label: 'Side left',
    engineView: 'side',
    profileSide: 'left',
  },
  {
    key: 'back',
    label: 'Back',
    engineView: 'back',
    profileSide: null,
  },
  {
    key: 'side_right',
    label: 'Side right',
    engineView: 'side',
    profileSide: 'right',
  },
] as const

export const TIER_B_METRIC_REGISTRY = [
  {
    key: 'anterior_imbalanced_shoulders',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['front'],
  },
  {
    key: 'posterior_imbalanced_shoulders',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['back'],
  },
  {
    key: 'pelvic_obliquity',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['front'],
  },
  {
    key: 'genu_varum_valgum_left',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['front'],
  },
  {
    key: 'genu_varum_valgum_right',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['front'],
  },
  {
    key: 'forward_head_posture',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['side_left', 'side_right'],
  },
  {
    key: 'trunk_lean',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['side_left', 'side_right'],
  },
  {
    key: 'knee_extension_back_knee',
    status: 'candidate',
    primaryUnit: 'percentage_points',
    requiredViews: ['side_left', 'side_right'],
  },
  {
    key: 'pelvic_axial_rotation',
    status: 'excluded_design',
    primaryUnit: 'percentage_points',
    requiredViews: ['front'],
    reasonCode: 'ENGINE_ALWAYS_UNRELIABLE',
  },
] as const

export type TierBView = typeof TIER_B_VIEWS[number]
export type TierBRepeatId = typeof TIER_B_REPEAT_IDS[number]
export type TierBPoseModel = 'lite' | 'full'
export type TierBMetricKey = typeof TIER_B_METRIC_REGISTRY[number]['key']
