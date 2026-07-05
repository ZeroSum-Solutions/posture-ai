/**
 * Posture Engine Tests
 * Verifies deterministic scoring, metric deviations, zones, grades.
 * Run: npx vitest run src/lib/posture-engine/
 */
import { describe, it, expect } from 'vitest'
import { assessPosture } from '../src'
import type { PoseFrame } from '../src'
import { toGrade, toPercentile } from '../src/thresholds'
import {
  forwardHeadPosture,
  anteriorImbalancedShoulders,
  posteriorImbalancedShoulders,
  trunkLean,
  pelvicObliquity,
  pelvicAxialRotation,
  genuVarumValgumLeft,
  genuVarumValgumRight,
  kneeExtensionBackKnee,
} from '../src/metrics'
import { generatePose } from '../golden/synthetic'

const EPSILON = 0.1 // degrees tolerance for hand-computed expected values

function withinEpsilon(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= EPSILON
}

function sideFrame(lm: Record<string, { x: number; y: number; z?: number; visibility?: number }>): PoseFrame {
  return { view: 'side', landmarks: lm }
}

function frontFrame(lm: Record<string, { x: number; y: number; z?: number; visibility?: number }>): PoseFrame {
  return { view: 'front', landmarks: lm }
}

// ============================================================
// Metric fixtures - controlled landmarks for hand-computed devs
// ============================================================

// Metric 1: forward_head_posture
// ear=(0.570, 0.150), shoulder=(0.500, 0.250)
// dx=0.07, dy=0.10 → atan2(0.07,0.10)*180/PI ≈ 34.99°
// nose right of the ear → subject faces image-right (facing-confirmed anterior).
const FHP_FRAME = sideFrame({
  nose:           { x: 0.640, y: 0.055, visibility: 0.90 },
  left_ear:       { x: 0.570, y: 0.150, visibility: 0.90 },
  right_ear:      { x: 0.560, y: 0.150, visibility: 0.10 },
  left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.90 },
  right_shoulder: { x: 0.510, y: 0.250, visibility: 0.10 },
  left_hip:       { x: 0.500, y: 0.550, visibility: 0.90 },
  right_hip:      { x: 0.505, y: 0.550, visibility: 0.10 },
  left_knee:      { x: 0.500, y: 0.750, visibility: 0.90 },
  right_knee:     { x: 0.505, y: 0.750, visibility: 0.10 },
  left_ankle:     { x: 0.500, y: 0.930, visibility: 0.90 },
  right_ankle:    { x: 0.505, y: 0.930, visibility: 0.10 },
})

// Same physical posture photographed facing the other way (x → 1−x): the label
// must not flip with the image direction.
const FHP_FRAME_MIRROR = sideFrame({
  nose:           { x: 0.360, y: 0.055, visibility: 0.90 },
  left_ear:       { x: 0.430, y: 0.150, visibility: 0.90 },
  right_ear:      { x: 0.440, y: 0.150, visibility: 0.10 },
  left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.90 },
  right_shoulder: { x: 0.490, y: 0.250, visibility: 0.10 },
  left_hip:       { x: 0.500, y: 0.550, visibility: 0.90 },
  right_hip:      { x: 0.495, y: 0.550, visibility: 0.10 },
  left_knee:      { x: 0.500, y: 0.750, visibility: 0.90 },
  right_knee:     { x: 0.495, y: 0.750, visibility: 0.10 },
  left_ankle:     { x: 0.500, y: 0.930, visibility: 0.90 },
  right_ankle:    { x: 0.495, y: 0.930, visibility: 0.10 },
})

// Head carried BEHIND the shoulder (facing-confirmed posterior): the metric is
// forward-specific, so this must not be scored as forward head posture.
const FHP_POSTERIOR_FRAME = sideFrame({
  nose:           { x: 0.500, y: 0.055, visibility: 0.90 },
  left_ear:       { x: 0.430, y: 0.150, visibility: 0.90 },
  left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.90 },
  left_hip:       { x: 0.500, y: 0.550, visibility: 0.90 },
})

// Metric 2/3: shoulder imbalance
// ls=(0.350,0.200), rs=(0.650,0.250)
// |atan2(-0.05, 0.30)*180/PI| ≈ 9.46°
const SHOULDER_FRAME = frontFrame({
  left_shoulder:  { x: 0.350, y: 0.200, visibility: 0.90 },
  right_shoulder: { x: 0.650, y: 0.250, visibility: 0.90 },
  left_hip:       { x: 0.380, y: 0.530, visibility: 0.90 },
  right_hip:      { x: 0.620, y: 0.530, visibility: 0.90 },
  left_knee:      { x: 0.380, y: 0.730, visibility: 0.90 },
  right_knee:     { x: 0.620, y: 0.730, visibility: 0.90 },
  left_ankle:     { x: 0.380, y: 0.930, visibility: 0.90 },
  right_ankle:    { x: 0.620, y: 0.930, visibility: 0.90 },
})

// Metric 4: t1_tilt_backward
// shoulder=(0.500,0.220), hip=(0.520,0.520)
// dx=0.020, dy=0.300 → atan2(0.020,0.300)*180/PI ≈ 3.81°
// nose right of the ear → faces image-right; hip anterior of shoulder = Backward.
const T1_FRAME = sideFrame({
  nose:           { x: 0.560, y: 0.055, visibility: 0.90 },
  left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.510, y: 0.220, visibility: 0.10 },
  left_hip:       { x: 0.520, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.530, y: 0.520, visibility: 0.10 },
  left_ear:       { x: 0.500, y: 0.060, visibility: 0.90 },
  right_ear:      { x: 0.505, y: 0.060, visibility: 0.10 },
  left_knee:      { x: 0.520, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.525, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.520, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.525, y: 0.920, visibility: 0.10 },
})

// T1_FRAME mirrored (x → 1−x): same backward tilt, subject faces image-left.
const T1_FRAME_MIRROR = sideFrame({
  nose:           { x: 0.440, y: 0.055, visibility: 0.90 },
  left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.490, y: 0.220, visibility: 0.10 },
  left_hip:       { x: 0.480, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.470, y: 0.520, visibility: 0.10 },
  left_ear:       { x: 0.500, y: 0.060, visibility: 0.90 },
  right_ear:      { x: 0.495, y: 0.060, visibility: 0.10 },
  left_knee:      { x: 0.480, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.475, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.480, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.475, y: 0.920, visibility: 0.10 },
})

// Metric 5: pelvic_obliquity
// lh=(0.380,0.520), rh=(0.620,0.550)
// |atan2(-0.030, 0.240)*180/PI| ≈ 7.13°
const PELVIS_FRONT_FRAME = frontFrame({
  left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
  left_hip:       { x: 0.380, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.620, y: 0.550, visibility: 0.90 },
  left_knee:      { x: 0.380, y: 0.730, visibility: 0.90 },
  right_knee:     { x: 0.620, y: 0.730, visibility: 0.90 },
  left_ankle:     { x: 0.380, y: 0.930, visibility: 0.90 },
  right_ankle:    { x: 0.620, y: 0.930, visibility: 0.90 },
})

// Metric 6: anterior_pelvic_shift
// shoulder=(0.500,0.220), hip=(0.540,0.520)
// dx=0.040, dy=0.300 → atan2(0.040,0.300)*180/PI ≈ 7.60°
// nose right of the ear → faces image-right; hip anterior of shoulder = Anterior.
const APS_FRAME = sideFrame({
  nose:           { x: 0.560, y: 0.055, visibility: 0.90 },
  left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.510, y: 0.220, visibility: 0.10 },
  left_hip:       { x: 0.540, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.550, y: 0.520, visibility: 0.10 },
  left_ear:       { x: 0.500, y: 0.060, visibility: 0.90 },
  right_ear:      { x: 0.505, y: 0.060, visibility: 0.10 },
  left_knee:      { x: 0.540, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.545, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.540, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.545, y: 0.920, visibility: 0.10 },
})

// APS_FRAME mirrored (x → 1−x): the same anterior shift, subject faces image-left.
const APS_FRAME_MIRROR = sideFrame({
  nose:           { x: 0.440, y: 0.055, visibility: 0.90 },
  left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.490, y: 0.220, visibility: 0.10 },
  left_hip:       { x: 0.460, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.450, y: 0.520, visibility: 0.10 },
  left_ear:       { x: 0.500, y: 0.060, visibility: 0.90 },
  right_ear:      { x: 0.495, y: 0.060, visibility: 0.10 },
  left_knee:      { x: 0.460, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.455, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.460, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.455, y: 0.920, visibility: 0.10 },
})

// Metric 7: pelvic_axial_rotation (needs z coords)
// lh.z=-0.050, rh.z=0.050 → zDiff=0.100
// atan2(0.100, 0.500)*180/PI ≈ 11.31°
const PAR_FRAME = frontFrame({
  left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
  left_hip:       { x: 0.380, y: 0.530, z: -0.050, visibility: 0.90 },
  right_hip:      { x: 0.620, y: 0.530, z:  0.050, visibility: 0.90 },
  left_knee:      { x: 0.380, y: 0.730, visibility: 0.90 },
  right_knee:     { x: 0.620, y: 0.730, visibility: 0.90 },
  left_ankle:     { x: 0.380, y: 0.930, visibility: 0.90 },
  right_ankle:    { x: 0.620, y: 0.930, visibility: 0.90 },
})

// Metric 8: genu_varum_valgum_left
// hip=(0.380,0.520), knee=(0.360,0.720), ankle=(0.380,0.920)
// v1=(0.020,-0.200), v2=(0.020,0.200)
// dot=-0.0396, mag=0.20100, angle≈168.46°, deviation≈11.54°
const GENU_L_FRAME = frontFrame({
  left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
  left_hip:       { x: 0.380, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.620, y: 0.520, visibility: 0.10 },
  left_knee:      { x: 0.360, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.640, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.380, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.620, y: 0.920, visibility: 0.10 },
})

// Metric 9: genu_varum_valgum_right
// hip=(0.620,0.520), knee=(0.640,0.720), ankle=(0.620,0.920)
// same geometry as left → deviation≈11.54°
const GENU_R_FRAME = frontFrame({
  left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
  left_hip:       { x: 0.380, y: 0.520, visibility: 0.10 },
  right_hip:      { x: 0.620, y: 0.520, visibility: 0.90 },
  left_knee:      { x: 0.360, y: 0.720, visibility: 0.10 },
  right_knee:     { x: 0.640, y: 0.720, visibility: 0.90 },
  left_ankle:     { x: 0.380, y: 0.920, visibility: 0.10 },
  right_ankle:    { x: 0.620, y: 0.920, visibility: 0.90 },
})

// Metric 10: knee_extension_back_knee — a straight leg is neutral (0°)
// hip=(0.500,0.520), knee=(0.500,0.720), ankle=(0.500,0.920)
// angle2D=180°, STANDARD=180°, deviation=|180-180|=0.00°
const KNEE_EXT_FRAME = sideFrame({
  left_ear:       { x: 0.500, y: 0.050, visibility: 0.90 },
  right_ear:      { x: 0.505, y: 0.050, visibility: 0.10 },
  left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.90 },
  right_shoulder: { x: 0.505, y: 0.220, visibility: 0.10 },
  left_hip:       { x: 0.500, y: 0.520, visibility: 0.90 },
  right_hip:      { x: 0.505, y: 0.520, visibility: 0.10 },
  left_knee:      { x: 0.500, y: 0.720, visibility: 0.90 },
  right_knee:     { x: 0.505, y: 0.720, visibility: 0.10 },
  left_ankle:     { x: 0.500, y: 0.920, visibility: 0.90 },
  right_ankle:    { x: 0.505, y: 0.920, visibility: 0.10 },
})

// Metric 10 direction fixtures — facing-aware hyperextension vs flexion.
// faceSign = sign(foot_index.x − heel.x); a knee posterior to the hip→ankle
// line (relative to facing) is Hyperextended. Each leg bends 6.87° off straight.
const KNEE_HYPEREXT_FACING_RIGHT = sideFrame({
  left_hip:        { x: 0.500, y: 0.500, visibility: 0.95 },
  left_knee:       { x: 0.488, y: 0.700, visibility: 0.95 },
  left_ankle:      { x: 0.500, y: 0.900, visibility: 0.95 },
  left_heel:       { x: 0.480, y: 0.920, visibility: 0.90 },
  left_foot_index: { x: 0.560, y: 0.960, visibility: 0.88 },
})
const KNEE_FLEXED_FACING_RIGHT = sideFrame({
  left_hip:        { x: 0.500, y: 0.500, visibility: 0.95 },
  left_knee:       { x: 0.512, y: 0.700, visibility: 0.95 },
  left_ankle:      { x: 0.500, y: 0.900, visibility: 0.95 },
  left_heel:       { x: 0.480, y: 0.920, visibility: 0.90 },
  left_foot_index: { x: 0.560, y: 0.960, visibility: 0.88 },
})
// Mirror of the hyperextension case: same posterior-knee geometry, subject
// faces the other way (toe left of heel), so the same image side reads as back-knee.
const KNEE_HYPEREXT_FACING_LEFT = sideFrame({
  left_hip:        { x: 0.500, y: 0.500, visibility: 0.95 },
  left_knee:       { x: 0.512, y: 0.700, visibility: 0.95 },
  left_ankle:      { x: 0.500, y: 0.900, visibility: 0.95 },
  left_heel:       { x: 0.520, y: 0.920, visibility: 0.90 },
  left_foot_index: { x: 0.440, y: 0.960, visibility: 0.88 },
})

// ============================================================
// Metric 1: Forward Head Posture
// ============================================================
describe('Metric 1: Forward Head Posture', () => {
  it('computes deviation ≈ 34.99° (hand-computed from fixture)', () => {
    const f = forwardHeadPosture(FHP_FRAME)
    // dx=0.07, dy=0.10 → atan2(0.07,0.10)*180/PI = 34.992°
    expect(withinEpsilon(f.deviation, 34.99)).toBe(true)
  })

  it('maps 35° FHP to danger zone', () => {
    const f = forwardHeadPosture(FHP_FRAME)
    expect(f.zone).toBe('danger')
  })

  it('maps 35° FHP to severityPct >= 66', () => {
    const f = forwardHeadPosture(FHP_FRAME)
    expect(f.severityPct).toBeGreaterThanOrEqual(66)
  })

  it('labels a facing-confirmed anterior ear Forward', () => {
    expect(forwardHeadPosture(FHP_FRAME).direction).toBe('Forward')
  })

  it('is mirror-invariant: the same posture facing image-left still reads Forward at ≈34.99°', () => {
    const f = forwardHeadPosture(FHP_FRAME_MIRROR)
    expect(withinEpsilon(f.deviation, 34.99)).toBe(true)
    expect(f.direction).toBe('Forward')
  })

  it('does not score a posterior head carriage as forward head posture', () => {
    // The thresholds and downstream content are anterior-specific (same rule as
    // the recurvatum metric): a backward-carried head reports Neutral / 0°.
    const f = forwardHeadPosture(FHP_POSTERIOR_FRAME)
    expect(f.direction).toBe('Neutral')
    expect(withinEpsilon(f.deviation, 0)).toBe(true)
  })
})

// ============================================================
// Metric 2: Anterior Imbalanced Shoulders
// ============================================================
describe('Metric 2: Anterior Imbalanced Shoulders', () => {
  it('computes shoulder deviation ≈ 9.46° (hand-computed from fixture)', () => {
    const f = anteriorImbalancedShoulders(SHOULDER_FRAME)
    // |atan2(0.200-0.250, 0.650-0.350)*180/PI| = |-9.462°| = 9.46°
    expect(withinEpsilon(f.deviation, 9.46)).toBe(true)
  })
})

// ============================================================
// Metric 3: Posterior Imbalanced Shoulders
// ============================================================
describe('Metric 3: Posterior Imbalanced Shoulders', () => {
  it('computes shoulder deviation ≈ 9.46° (hand-computed from fixture)', () => {
    const f = posteriorImbalancedShoulders(SHOULDER_FRAME, undefined)
    expect(withinEpsilon(f.deviation, 9.46)).toBe(true)
  })
})

// ============================================================
// Metric 4: Trunk Lean (replaces t1_tilt_backward + anterior_pelvic_shift)
// ============================================================
describe('Metric 4: Trunk Lean', () => {
  it('computes trunk lean deviation ≈ 3.81° (hand-computed from fixture)', () => {
    const f = trunkLean(T1_FRAME)
    // shoulder=(0.500,0.220), hip=(0.520,0.520)
    // dx=0.020, dy=0.300 → atan2(0.020,0.300)*180/PI = 3.814°
    expect(withinEpsilon(f.deviation, 3.81)).toBe(true)
  })

  it('labels the facing-confirmed posterior shoulder Backward', () => {
    expect(trunkLean(T1_FRAME).direction).toBe('Backward')
  })

  it('is mirror-invariant: the same tilt facing image-left still reads Backward', () => {
    const f = trunkLean(T1_FRAME_MIRROR)
    expect(withinEpsilon(f.deviation, 3.81)).toBe(true)
    expect(f.direction).toBe('Backward')
  })
})

// ============================================================
// Metric 5: Pelvic Obliquity
// ============================================================
describe('Metric 5: Pelvic Obliquity', () => {
  it('computes pelvic obliquity ≈ 7.13° (hand-computed from fixture)', () => {
    const f = pelvicObliquity(PELVIS_FRONT_FRAME)
    // |atan2(0.520-0.550, 0.620-0.380)*180/PI| = |-7.125°| = 7.13°
    expect(withinEpsilon(f.deviation, 7.13)).toBe(true)
  })
})

// ============================================================
// Metric 6: Trunk Lean (larger deviation fixture — retargeted from anterior_pelvic_shift)
// ============================================================
describe('Metric 6: Trunk Lean (larger deviation fixture)', () => {
  it('computes trunk lean deviation ≈ 7.60° (hand-computed from APS fixture)', () => {
    const f = trunkLean(APS_FRAME)
    // shoulder=(0.500,0.220), hip=(0.540,0.520)
    // dx=0.040, dy=0.300 → atan2(0.040,0.300)*180/PI = 7.595°
    expect(withinEpsilon(f.deviation, 7.60)).toBe(true)
  })

  it('labels the facing-confirmed posterior shoulder Backward', () => {
    // shoulder.x=0.500 < hip.x=0.540 → shoulderAnterior = -1 → Backward
    expect(trunkLean(APS_FRAME).direction).toBe('Backward')
  })

  it('is mirror-invariant: the same lean facing image-left still reads Backward', () => {
    const f = trunkLean(APS_FRAME_MIRROR)
    expect(withinEpsilon(f.deviation, 7.60)).toBe(true)
    expect(f.direction).toBe('Backward')
  })
})

// ============================================================
// Metric 7: Pelvic Axial Rotation
// ============================================================
describe('Metric 7: Pelvic Axial Rotation', () => {
  it('computes pelvic rotation ≈ 11.31° (hand-computed from fixture)', () => {
    const f = pelvicAxialRotation(PAR_FRAME)
    // zDiff=0.100, hip_width≈0.500 → atan2(0.100,0.500)*180/PI = 11.310°
    expect(withinEpsilon(f.deviation, 11.31)).toBe(true)
  })

  // Transverse-plane rotation is not reliably recoverable from 2-view markerless
  // capture (r=0.00–0.19 vs Vicon; RMSE >7°; no validated pathology threshold).
  // It is measured for traceability but must never be scored — research G4
  // sign-off: "measure but do not score, do not assign muscle inferences".
  it('is never scored even with full z-data present', () => {
    const f = pelvicAxialRotation(PAR_FRAME)
    expect(f.reliable).toBe(false)
    expect(f.zone).toBe('unreliable')
    expect(f.severityPct).toBe(0)
    // the measured deviation is still surfaced for traceability
    expect(withinEpsilon(f.deviation, 11.31)).toBe(true)
  })
})

// ============================================================
// Metric 8: Genu Varum/Valgum Left
// ============================================================
describe('Metric 8: Genu Varum/Valgum Left', () => {
  it('computes knee deviation ≈ 11.42° (hand-computed from fixture)', () => {
    const f = genuVarumValgumLeft(GENU_L_FRAME)
    // hip=(0.380,0.520), knee=(0.360,0.720), ankle=(0.380,0.920)
    // v1=(0.020,-0.200), v2=(0.020,0.200), dot=-0.0396, angle≈168.58°
    // deviation=|180-168.58|≈11.42°
    expect(withinEpsilon(f.deviation, 11.42)).toBe(true)
  })

  it('labels a knee displaced AWAY from the midline Varum (Bow-Leg)', () => {
    // GENU_L_FRAME: left knee (x=0.360) sits lateral to the hip→ankle chord
    // (x=0.380) relative to the body midline (x≈0.5) — that is a bow-leg.
    expect(genuVarumValgumLeft(GENU_L_FRAME).direction).toBe('Varum (Bow-Leg)')
  })

  it('labels a knee collapsed TOWARD the midline Valgum (Knock-Knee) at the same magnitude', () => {
    const GENU_L_VALGUS = frontFrame({
      left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
      right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
      left_hip:       { x: 0.380, y: 0.520, visibility: 0.90 },
      right_hip:      { x: 0.620, y: 0.520, visibility: 0.10 },
      left_knee:      { x: 0.400, y: 0.720, visibility: 0.90 },
      left_ankle:     { x: 0.380, y: 0.920, visibility: 0.90 },
    })
    const f = genuVarumValgumLeft(GENU_L_VALGUS)
    expect(withinEpsilon(f.deviation, 11.42)).toBe(true)
    expect(f.direction).toBe('Valgum (Knock-Knee)')
  })
})

// ============================================================
// Metric 9: Genu Varum/Valgum Right
// ============================================================
describe('Metric 9: Genu Varum/Valgum Right', () => {
  it('computes knee deviation ≈ 11.42° (hand-computed from fixture)', () => {
    const f = genuVarumValgumRight(GENU_R_FRAME)
    // right: hip=(0.620,0.520), knee=(0.640,0.720), ankle=(0.620,0.920)
    // same geometry as left → deviation≈11.42°
    expect(withinEpsilon(f.deviation, 11.42)).toBe(true)
  })

  it('labels a right knee displaced AWAY from the midline Varum (Bow-Leg)', () => {
    // knee x=0.640 is lateral to the chord (x=0.620) — midline is at x≈0.5.
    expect(genuVarumValgumRight(GENU_R_FRAME).direction).toBe('Varum (Bow-Leg)')
  })
})

// ============================================================
// Metric 10: Knee Extension / Back Knee
// ============================================================
describe('Metric 10: Knee Extension / Back Knee', () => {
  it('treats a straight leg as neutral (0° deviation, STANDARD=180)', () => {
    const f = kneeExtensionBackKnee(KNEE_EXT_FRAME)
    // hip/knee/ankle collinear → angle2D=180°, deviation=|180-180|=0
    expect(withinEpsilon(f.deviation, 0)).toBe(true)
    expect(f.direction).toBe('Neutral')
  })

  it('a straight leg does NOT land in the warning zone (regression)', () => {
    // STANDARD used to be 175°, so a straight knee scored 5° → warning,
    // severity 33, silently penalising every healthy knee in the aggregate.
    const f = kneeExtensionBackKnee(KNEE_EXT_FRAME)
    expect(f.zone).toBe('maintain')
    expect(f.severityPct).toBe(0)
  })

  it('flags a confirmed back-knee as Hyperextended, facing right', () => {
    const f = kneeExtensionBackKnee(KNEE_HYPEREXT_FACING_RIGHT)
    expect(withinEpsilon(f.deviation, 6.87)).toBe(true)
    expect(f.direction).toBe('Hyperextended')
    expect(f.zone).toBe('warning')
  })

  it('does NOT score a flexed knee as recurvatum (facing right)', () => {
    // Same magnitude as the back-knee case, but the knee is anterior → flexion,
    // not recurvatum. The recurvatum-specific thresholds/copy must not apply.
    const f = kneeExtensionBackKnee(KNEE_FLEXED_FACING_RIGHT)
    expect(f.deviation).toBe(0)
    expect(f.direction).toBe('Neutral')
    expect(f.zone).toBe('maintain')
  })

  it('reads recurvatum from foot orientation, not raw image side (facing left)', () => {
    // Identical knee geometry to the flexed-facing-right case, but the subject
    // faces the other way, so the same image side IS a back-knee.
    const f = kneeExtensionBackKnee(KNEE_HYPEREXT_FACING_LEFT)
    expect(withinEpsilon(f.deviation, 6.87)).toBe(true)
    expect(f.direction).toBe('Hyperextended')
  })

  it('does NOT flag a back-knee when facing cannot be verified (conservative)', () => {
    // No feet and no nose/ear pair → facing unknown. We cannot confirm the knee
    // is posterior, so it is not scored as recurvatum (avoids a false citation).
    const noFacing = sideFrame({
      left_hip:   { x: 0.500, y: 0.500, visibility: 0.95 },
      left_knee:  { x: 0.488, y: 0.700, visibility: 0.95 },
      left_ankle: { x: 0.500, y: 0.900, visibility: 0.95 },
    })
    const f = kneeExtensionBackKnee(noFacing)
    expect(f.deviation).toBe(0)
    expect(f.direction).toBe('Neutral')
  })
})

// ============================================================
// Trunk Lean merge (engine 2.0.0): single finding, no legacy keys
// ============================================================
describe('trunk_lean merge: emits one finding, no legacy t1/shift keys', () => {
  it('emits exactly one trunk_lean finding and no legacy t1/shift keys', () => {
    const result = assessPosture([generatePose('front', {}), generatePose('side', { trunkLeanDeg: 6 })])
    const keys = result.findings.map(f => f.key)
    expect(keys).toContain('trunk_lean')
    expect(keys).not.toContain('t1_tilt_backward')
    expect(keys).not.toContain('anterior_pelvic_shift')
    const tl = result.findings.find(f => f.key === 'trunk_lean')!
    expect(Math.abs(tl.deviation - 6)).toBeLessThan(0.15)
    expect(tl.direction).toBe('Forward')
  })
})

// ============================================================
// Zone and Grade Tests
// ============================================================
describe('Grade boundary tests (unit tests on toGrade)', () => {
  it('overallScore=50 maps to grade B', () => {
    expect(toGrade(50)).toBe('B')
  })

  it('overallScore=86 maps to grade D', () => {
    expect(toGrade(86)).toBe('D')
  })

  it('overallScore=0 maps to grade S', () => {
    expect(toGrade(0)).toBe('S')
  })

  it('overallScore=14 maps to grade A', () => {
    expect(toGrade(14)).toBe('A')
  })

  it('overallScore=51 maps to grade C', () => {
    expect(toGrade(51)).toBe('C')
  })

  it('overallScore=96 maps to grade E', () => {
    expect(toGrade(96)).toBe('E')
  })
})

// ============================================================
// All-optimal fixture produces grade S or A
// ============================================================
describe('All-optimal fixture → grade S or A', () => {
  // Perfect posture: level shoulders/hips, ear above shoulder, straight knee
  const OPTIMAL_FRONT: PoseFrame = frontFrame({
    left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.99 },
    right_shoulder: { x: 0.650, y: 0.220, visibility: 0.99 },
    left_hip:       { x: 0.380, y: 0.530, visibility: 0.99 },
    right_hip:      { x: 0.620, y: 0.530, visibility: 0.99 },
    left_knee:      { x: 0.380, y: 0.730, visibility: 0.99 },
    right_knee:     { x: 0.620, y: 0.730, visibility: 0.99 },
    left_ankle:     { x: 0.380, y: 0.930, visibility: 0.99 },
    right_ankle:    { x: 0.620, y: 0.930, visibility: 0.99 },
  })

  const OPTIMAL_SIDE: PoseFrame = sideFrame({
    left_ear:       { x: 0.500, y: 0.050, visibility: 0.99 },
    right_ear:      { x: 0.500, y: 0.050, visibility: 0.10 },
    left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.99 },
    right_shoulder: { x: 0.500, y: 0.220, visibility: 0.10 },
    left_hip:       { x: 0.500, y: 0.520, visibility: 0.99 },
    right_hip:      { x: 0.500, y: 0.520, visibility: 0.10 },
    left_knee:      { x: 0.500, y: 0.720, visibility: 0.99 },
    right_knee:     { x: 0.500, y: 0.720, visibility: 0.10 },
    left_ankle:     { x: 0.500, y: 0.920, visibility: 0.99 },
    right_ankle:    { x: 0.500, y: 0.920, visibility: 0.10 },
  })

  it('produces overallGrade S or A for all-optimal deviations (≤5° each)', () => {
    const result = assessPosture([OPTIMAL_FRONT, OPTIMAL_SIDE])
    expect(['S', 'A']).toContain(result.overallGrade)
  })

  it('produces overallScore ≤ 15 for all-optimal deviations', () => {
    const result = assessPosture([OPTIMAL_FRONT, OPTIMAL_SIDE])
    expect(result.overallScore).toBeLessThanOrEqual(15)
  })
})

// ============================================================
// Determinism: same input → same output
// ============================================================
describe('Determinism', () => {
  it('assessPosture() is deterministic (same input → same output)', () => {
    const frames: PoseFrame[] = [
      SHOULDER_FRAME,
      sideFrame({
        left_ear:       { x: 0.535, y: 0.050, visibility: 0.90 },
        right_ear:      { x: 0.560, y: 0.050, visibility: 0.15 },
        left_shoulder:  { x: 0.500, y: 0.220, visibility: 0.92 },
        right_shoulder: { x: 0.510, y: 0.222, visibility: 0.20 },
        left_hip:       { x: 0.520, y: 0.530, visibility: 0.92 },
        right_hip:      { x: 0.525, y: 0.532, visibility: 0.20 },
        left_knee:      { x: 0.505, y: 0.730, visibility: 0.90 },
        right_knee:     { x: 0.510, y: 0.732, visibility: 0.18 },
        left_ankle:     { x: 0.500, y: 0.920, visibility: 0.88 },
        right_ankle:    { x: 0.505, y: 0.922, visibility: 0.16 },
      }),
    ]

    const r1 = assessPosture(frames)
    const r2 = assessPosture(frames)

    expect(r1.overallScore).toBe(r2.overallScore)
    expect(r1.overallGrade).toBe(r2.overallGrade)
    expect(r1.overallPercentile).toBe(r2.overallPercentile)
    expect(r1.findings.length).toBe(r2.findings.length)
    r1.findings.forEach((f, i) => {
      expect(f.key).toBe(r2.findings[i].key)
      expect(f.deviation).toBe(r2.findings[i].deviation)
      expect(f.zone).toBe(r2.findings[i].zone)
      expect(f.severityPct).toBe(r2.findings[i].severityPct)
    })
  })
})

// ============================================================
// Low confidence → reliable:false
// ============================================================
describe('Low confidence landmarks', () => {
  it('marks finding as reliable:false when confidence < 0.5', () => {
    // Use FHP frame but with very low visibility
    const lowVisFrame = sideFrame({
      left_ear:       { x: 0.570, y: 0.150, visibility: 0.30 },
      right_ear:      { x: 0.560, y: 0.150, visibility: 0.25 },
      left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.35 },
      right_shoulder: { x: 0.510, y: 0.250, visibility: 0.20 },
      left_hip:       { x: 0.500, y: 0.550, visibility: 0.40 },
      right_hip:      { x: 0.505, y: 0.550, visibility: 0.20 },
      left_knee:      { x: 0.500, y: 0.750, visibility: 0.40 },
      right_knee:     { x: 0.505, y: 0.750, visibility: 0.20 },
      left_ankle:     { x: 0.500, y: 0.930, visibility: 0.40 },
      right_ankle:    { x: 0.505, y: 0.930, visibility: 0.20 },
    })
    // confidence = minVis(ear, shoulder) = min(0.30, 0.35) = 0.30 < 0.5
    const f = forwardHeadPosture(lowVisFrame)
    expect(f.reliable).toBe(false)
    expect(f.zone).toBe('unreliable')
  })

  it('low-confidence metrics are excluded from overallScore aggregate', () => {
    // Frame with all low-vis side landmarks but normal front landmarks
    const lowVisSide = sideFrame({
      left_ear:       { x: 0.570, y: 0.150, visibility: 0.30 },
      right_ear:      { x: 0.560, y: 0.150, visibility: 0.25 },
      left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.35 },
      right_shoulder: { x: 0.510, y: 0.250, visibility: 0.20 },
      left_hip:       { x: 0.500, y: 0.550, visibility: 0.40 },
      right_hip:      { x: 0.505, y: 0.550, visibility: 0.20 },
      left_knee:      { x: 0.500, y: 0.750, visibility: 0.40 },
      right_knee:     { x: 0.505, y: 0.750, visibility: 0.20 },
      left_ankle:     { x: 0.500, y: 0.930, visibility: 0.40 },
      right_ankle:    { x: 0.505, y: 0.930, visibility: 0.20 },
    })
    const result = assessPosture([SHOULDER_FRAME, lowVisSide])

    // All side findings are unreliable (conf < 0.5), so overallScore uses only front findings
    const reliableFindings = result.findings.filter(f => f.reliable)
    const unreliableFindings = result.findings.filter(f => !f.reliable)

    // Verify unreliable findings exist and are excluded
    expect(unreliableFindings.length).toBeGreaterThan(0)

    // overallScore should equal average of reliable findings only
    const expectedScore = reliableFindings.length > 0
      ? Math.round(reliableFindings.reduce((acc, f) => acc + f.severityPct, 0) / reliableFindings.length)
      : 0
    expect(result.overallScore).toBe(expectedScore)
  })
})

// ============================================================
// Mirror invariance — real MediaPipe front-view convention
// MediaPipe labels landmarks by the SUBJECT's anatomy, so on a
// front-facing photo the subject's LEFT lands on the image's RIGHT
// (left_shoulder.x > right_shoulder.x). A left-right mirror of the
// same posture must NOT change a tilt magnitude. Regression test for
// the reflex-angle bug (signed horizontal run in atan2 → ~180°).
// ============================================================
describe('Mirror invariance (real MediaPipe front-view convention)', () => {
  // SHOULDER_FRAME mirrored: subject-left landmarks on the image's right
  const MIRRORED_SHOULDER_FRAME = frontFrame({
    left_shoulder:  { x: 0.650, y: 0.200, visibility: 0.90 },
    right_shoulder: { x: 0.350, y: 0.250, visibility: 0.90 },
    left_hip:       { x: 0.620, y: 0.530, visibility: 0.90 },
    right_hip:      { x: 0.380, y: 0.530, visibility: 0.90 },
    left_knee:      { x: 0.620, y: 0.730, visibility: 0.90 },
    right_knee:     { x: 0.380, y: 0.730, visibility: 0.90 },
    left_ankle:     { x: 0.620, y: 0.930, visibility: 0.90 },
    right_ankle:    { x: 0.380, y: 0.930, visibility: 0.90 },
  })

  it('anterior shoulder deviation is mirror-invariant ≈ 9.46° (not ~170°)', () => {
    const f = anteriorImbalancedShoulders(MIRRORED_SHOULDER_FRAME)
    expect(withinEpsilon(f.deviation, 9.46)).toBe(true)
    expect(f.direction).toBe('Right Low') // subject's right shoulder is lower
  })

  it('posterior shoulder deviation is mirror-invariant ≈ 9.46°', () => {
    const f = posteriorImbalancedShoulders(MIRRORED_SHOULDER_FRAME, undefined)
    expect(withinEpsilon(f.deviation, 9.46)).toBe(true)
  })

  // PELVIS_FRONT_FRAME mirrored: subject-left hip on the image's right
  const MIRRORED_PELVIS_FRAME = frontFrame({
    left_shoulder:  { x: 0.650, y: 0.220, visibility: 0.90 },
    right_shoulder: { x: 0.350, y: 0.220, visibility: 0.90 },
    left_hip:       { x: 0.620, y: 0.520, visibility: 0.90 },
    right_hip:      { x: 0.380, y: 0.550, visibility: 0.90 },
    left_knee:      { x: 0.620, y: 0.730, visibility: 0.90 },
    right_knee:     { x: 0.380, y: 0.730, visibility: 0.90 },
    left_ankle:     { x: 0.620, y: 0.930, visibility: 0.90 },
    right_ankle:    { x: 0.380, y: 0.930, visibility: 0.90 },
  })

  it('pelvic obliquity deviation is mirror-invariant ≈ 7.13° (not ~173°)', () => {
    const f = pelvicObliquity(MIRRORED_PELVIS_FRAME)
    expect(withinEpsilon(f.deviation, 7.13)).toBe(true)
  })
})

// ============================================================
// Per-view rank for an all-unreliable view → null (not 1/best)
// A view with zero reliable findings must not report "Rank 1st".
// ============================================================
describe('Per-view rank for an all-unreliable view', () => {
  it('returns null rank when a view has no reliable findings (not 1/best)', () => {
    const lowVisSide = sideFrame({
      left_ear:       { x: 0.570, y: 0.150, visibility: 0.30 },
      right_ear:      { x: 0.560, y: 0.150, visibility: 0.25 },
      left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.35 },
      right_shoulder: { x: 0.510, y: 0.250, visibility: 0.20 },
      left_hip:       { x: 0.500, y: 0.550, visibility: 0.40 },
      right_hip:      { x: 0.505, y: 0.550, visibility: 0.20 },
      left_knee:      { x: 0.500, y: 0.750, visibility: 0.40 },
      right_knee:     { x: 0.505, y: 0.750, visibility: 0.20 },
      left_ankle:     { x: 0.500, y: 0.930, visibility: 0.40 },
      right_ankle:    { x: 0.505, y: 0.930, visibility: 0.20 },
    })
    const result = assessPosture([SHOULDER_FRAME, lowVisSide])
    expect(result.ranks.side).toBeNull()
    expect(typeof result.ranks.front).toBe('number')
  })
})
