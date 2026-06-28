import { PoseFrame, Finding, Zone } from './types'
import { angle2D, angleFromVertical, midpoint, minVis } from './geometry'
import { toZoneAndPct, RELIABILITY_FLOOR } from './thresholds'

type PartialFinding = Omit<Finding, 'zone' | 'severityPct'>

function makeFinding(
  key: string, label: string, region: Finding['region'],
  deviation: number, direction: string, viewUsed: Finding['viewUsed'],
  confidence: number, landmarksUsed: string[]
): Finding {
  const reliable = confidence >= RELIABILITY_FLOOR
  if (!reliable) {
    return { key, label, region, deviation, standard: 0, unit: 'deg', direction, severityPct: 0, zone: 'unreliable', viewUsed, confidence, reliable, landmarksUsed }
  }
  const { zone, severityPct } = toZoneAndPct(deviation, key)
  return { key, label, region, deviation, standard: 0, unit: 'deg', direction, severityPct, zone, viewUsed, confidence, reliable, landmarksUsed }
}

function getLm(frame: PoseFrame, name: string) {
  return frame.landmarks[name]
}

/** 1. Forward head posture — side view */
export function forwardHeadPosture(side: PoseFrame): Finding {
  const key = 'forward_head_posture'
  // Prefer whichever ear is more visible
  const leftEar = getLm(side, 'left_ear')
  const rightEar = getLm(side, 'right_ear')
  const leftShoulder = getLm(side, 'left_shoulder')
  const rightShoulder = getLm(side, 'right_shoulder')

  // Use the side with higher visibility
  const useRight = (rightEar?.visibility ?? 0) > (leftEar?.visibility ?? 0)
  const ear = useRight ? rightEar : leftEar
  const shoulder = useRight ? rightShoulder : leftShoulder

  if (!ear || !shoulder) return makeFinding(key, 'Forward Head Posture', 'head_shoulders', 0, 'Neutral', 'side', 0, [])

  const conf = minVis(ear, shoulder)
  // angle of (shoulder -> ear) from vertical
  const dx = ear.x - shoulder.x
  const dy = shoulder.y - ear.y  // positive = up in image
  const deviation = Math.abs(angleFromVertical(dx, dy))
  const direction = deviation < 1 ? 'Neutral' : 'Forward'
  return makeFinding(key, 'Forward Head Posture', 'head_shoulders', deviation, direction, 'side', conf,
    useRight ? ['right_ear','right_shoulder'] : ['left_ear','left_shoulder'])
}

/** 2. Anterior imbalanced shoulders — front view */
export function anteriorImbalancedShoulders(front: PoseFrame): Finding {
  const key = 'anterior_imbalanced_shoulders'
  const ls = getLm(front, 'left_shoulder')
  const rs = getLm(front, 'right_shoulder')
  if (!ls || !rs) return makeFinding(key, 'Shoulder Imbalance (Front)', 'head_shoulders', 0, 'Level', 'front', 0, [])

  const conf = minVis(ls, rs)
  // angle of shoulder line from horizontal. |Δx| makes the magnitude
  // mirror-invariant (MediaPipe puts the subject's left on the image's
  // right); sign(Δy) gives direction: + = subject's left shoulder lower
  const deviation = Math.atan2(ls.y - rs.y, Math.abs(rs.x - ls.x)) * (180 / Math.PI)
  const direction = Math.abs(deviation) < 0.5 ? 'Level' : deviation > 0 ? 'Left Low' : 'Right Low'
  return makeFinding(key, 'Shoulder Imbalance (Front)', 'head_shoulders', Math.abs(deviation), direction, 'front', conf, ['left_shoulder','right_shoulder'])
}

/** 3. Posterior imbalanced shoulders — back or front view */
export function posteriorImbalancedShoulders(front: PoseFrame, back?: PoseFrame): Finding {
  const key = 'posterior_imbalanced_shoulders'
  const frame = back ?? front
  const ls = getLm(frame, 'left_shoulder')
  const rs = getLm(frame, 'right_shoulder')
  if (!ls || !rs) return makeFinding(key, 'Shoulder Imbalance (Back)', 'head_shoulders', 0, 'Level', 'front', 0, [])

  const conf = minVis(ls, rs)
  const deviation = Math.atan2(ls.y - rs.y, Math.abs(rs.x - ls.x)) * (180 / Math.PI)
  const direction = Math.abs(deviation) < 0.5 ? 'Level' : deviation > 0 ? 'Left Low' : 'Right Low'
  const viewUsed = back ? 'back' : 'front'
  return makeFinding(key, 'Shoulder Imbalance (Back)', 'head_shoulders', Math.abs(deviation), direction, viewUsed, conf, ['left_shoulder','right_shoulder'])
}

/** 4. T1 tilt backward — side view */
export function t1TiltBackward(side: PoseFrame): Finding {
  const key = 't1_tilt_backward'
  const ls = getLm(side, 'left_shoulder')
  const rs = getLm(side, 'right_shoulder')
  const lh = getLm(side, 'left_hip')
  const rh = getLm(side, 'right_hip')

  const useRight = (rs?.visibility ?? 0) > (ls?.visibility ?? 0)
  const shoulder = useRight ? rs : ls
  const hip = useRight ? rh : lh

  if (!shoulder || !hip) return makeFinding(key, 'T1 Tilt (Backward)', 'spine', 0, 'Neutral', 'side', 0, [])

  const conf = minVis(shoulder, hip)
  // Positive = shoulder behind hip (backward tilt)
  const dx = hip.x - shoulder.x  // + means shoulder in front of hip
  const dy = hip.y - shoulder.y  // should be positive (hip is lower)
  const deviation = Math.abs(angleFromVertical(dx, dy))
  const direction = deviation < 1 ? 'Neutral' : dx > 0 ? 'Backward' : 'Forward'
  return makeFinding(key, 'T1 Tilt', 'spine', deviation, direction, 'side', conf,
    useRight ? ['right_shoulder','right_hip'] : ['left_shoulder','left_hip'])
}

/** 5. Pelvic obliquity — front view */
export function pelvicObliquity(front: PoseFrame): Finding {
  const key = 'pelvic_obliquity'
  const lh = getLm(front, 'left_hip')
  const rh = getLm(front, 'right_hip')
  if (!lh || !rh) return makeFinding(key, 'Pelvic Obliquity', 'pelvis', 0, 'Level', 'front', 0, [])

  const conf = minVis(lh, rh)
  const deviation = Math.atan2(lh.y - rh.y, Math.abs(rh.x - lh.x)) * (180 / Math.PI)
  const direction = Math.abs(deviation) < 0.5 ? 'Level' : deviation > 0 ? 'Left Low' : 'Right Low'
  return makeFinding(key, 'Pelvic Obliquity', 'pelvis', Math.abs(deviation), direction, 'front', conf, ['left_hip','right_hip'])
}

/** 6. Anterior pelvic shift — side view */
export function anteriorPelvicShift(side: PoseFrame): Finding {
  const key = 'anterior_pelvic_shift'
  const ls = getLm(side, 'left_shoulder')
  const rs = getLm(side, 'right_shoulder')
  const lh = getLm(side, 'left_hip')
  const rh = getLm(side, 'right_hip')

  const useRight = (rs?.visibility ?? 0) > (ls?.visibility ?? 0)
  const shoulder = useRight ? rs : ls
  const hip = useRight ? rh : lh

  if (!shoulder || !hip) return makeFinding(key, 'Anterior Pelvic Shift', 'pelvis', 0, 'Neutral', 'side', 0, [])

  const conf = minVis(shoulder, hip)
  // angle of (shoulder -> hip) from vertical: + = hip in front of shoulder (anterior)
  const dx = hip.x - shoulder.x
  const dy = hip.y - shoulder.y
  const deviation = angleFromVertical(dx, dy)
  const direction = Math.abs(deviation) < 1 ? 'Neutral' : deviation > 0 ? 'Anterior' : 'Posterior'
  return makeFinding(key, 'Anterior Pelvic Shift', 'pelvis', Math.abs(deviation), direction, 'side', conf,
    useRight ? ['right_shoulder','right_hip'] : ['left_shoulder','left_hip'])
}

/**
 * 7. Pelvic axial rotation — transverse plane, estimated from hip-z asymmetry.
 *
 * MEASURED BUT NEVER SCORED. Transverse-plane rotation is not reliably
 * recoverable from 2-view markerless capture (r=0.00–0.19 vs Vicon; RMSE >7°;
 * no validated pathology threshold — expert opinion only). Per research G4
 * sign-off we still estimate a deviation for display/traceability, but the
 * finding is held below RELIABILITY_FLOOR so it stays zone='unreliable',
 * severityPct=0, and is excluded from the overall score, ranks, and program
 * priorities. Its muscle inferences are likewise detached (content + DB seed).
 */
const AXIAL_ROTATION_CONFIDENCE = 0.3 // intentionally < RELIABILITY_FLOOR

export function pelvicAxialRotation(front: PoseFrame): Finding {
  const key = 'pelvic_axial_rotation'
  const lh = getLm(front, 'left_hip')
  const rh = getLm(front, 'right_hip')
  if (!lh || !rh) return makeFinding(key, 'Pelvic Rotation', 'pelvis', 0, 'Neutral', 'front', 0, [])

  // Estimate a deviation when z is available (MediaPipe world z), purely for
  // display — confidence is capped below the floor regardless of landmark
  // visibility, so this is never scored.
  let deviation = 0
  let direction = 'Neutral'
  if ((lh.z !== undefined) && (rh.z !== undefined)) {
    const zDiff = Math.abs(lh.z - rh.z)
    // Rough estimate: 10cm z-diff ~ 10 degrees rotation on ~50cm hip width
    deviation = Math.atan2(zDiff, 0.5) * (180 / Math.PI)
    direction = lh.z < rh.z ? 'Left Forward' : 'Right Forward'
  }
  return makeFinding(key, 'Pelvic Rotation', 'pelvis', deviation, direction, 'front', AXIAL_ROTATION_CONFIDENCE, ['left_hip','right_hip'])
}

/** 8. Genu varum/valgum left — front view */
export function genuVarumValgumLeft(front: PoseFrame): Finding {
  const key = 'genu_varum_valgum_left'
  const hip = getLm(front, 'left_hip')
  const knee = getLm(front, 'left_knee')
  const ankle = getLm(front, 'left_ankle')
  if (!hip || !knee || !ankle) return makeFinding(key, 'Knee Alignment Left', 'leg', 0, 'Neutral', 'front', 0, [])

  const conf = minVis(hip, knee, ankle)
  const angleAtKnee = angle2D(hip, knee, ankle)
  const deviation = 180 - angleAtKnee  // +ve = valgum (knock knee); -ve = varum (bow leg)
  const direction = Math.abs(deviation) < 1 ? 'Neutral' : deviation > 0 ? 'Valgum (Knock-Knee)' : 'Varum (Bow-Leg)'
  return makeFinding(key, 'Knee Alignment Left', 'leg', Math.abs(deviation), direction, 'front', conf, ['left_hip','left_knee','left_ankle'])
}

/** 9. Genu varum/valgum right — front view */
export function genuVarumValgumRight(front: PoseFrame): Finding {
  const key = 'genu_varum_valgum_right'
  const hip = getLm(front, 'right_hip')
  const knee = getLm(front, 'right_knee')
  const ankle = getLm(front, 'right_ankle')
  if (!hip || !knee || !ankle) return makeFinding(key, 'Knee Alignment Right', 'leg', 0, 'Neutral', 'front', 0, [])

  const conf = minVis(hip, knee, ankle)
  const angleAtKnee = angle2D(hip, knee, ankle)
  const deviation = 180 - angleAtKnee
  const direction = Math.abs(deviation) < 1 ? 'Neutral' : deviation > 0 ? 'Valgum (Knock-Knee)' : 'Varum (Bow-Leg)'
  return makeFinding(key, 'Knee Alignment Right', 'leg', Math.abs(deviation), direction, 'front', conf, ['right_hip','right_knee','right_ankle'])
}

// Below this magnitude the sagittal knee deviation is treated as neutral and no
// hyperextension/flexion direction is asserted.
const KNEE_NEUTRAL_EPS = 1

/**
 * Sagittal (side-view) facing direction: +1 = subject faces image-right,
 * −1 = faces image-left, 0 = indeterminate. The toe (foot_index) is anterior to
 * the heel; falls back to nose-anterior-to-ear when the foot is occluded. Needed
 * because angle2D is unsigned [0,180] and cannot, by itself, tell a back-knee
 * (hyperextension) from a flexed knee.
 */
function sagittalFacing(frame: PoseFrame, useRight: boolean): number {
  const FACE_EPS = 0.005
  const footPairs: [string, string][] = useRight
    ? [['right_foot_index', 'right_heel'], ['left_foot_index', 'left_heel']]
    : [['left_foot_index', 'left_heel'], ['right_foot_index', 'right_heel']]
  for (const [toeName, heelName] of footPairs) {
    const toe = getLm(frame, toeName)
    const heel = getLm(frame, heelName)
    if (toe && heel && minVis(toe, heel) >= RELIABILITY_FLOOR && Math.abs(toe.x - heel.x) > FACE_EPS) {
      return Math.sign(toe.x - heel.x)
    }
  }
  const nose = getLm(frame, 'nose')
  const ear = getLm(frame, useRight ? 'right_ear' : 'left_ear') ?? getLm(frame, useRight ? 'left_ear' : 'right_ear')
  if (nose && ear && minVis(nose, ear) >= RELIABILITY_FLOOR && Math.abs(nose.x - ear.x) > FACE_EPS) {
    return Math.sign(nose.x - ear.x)
  }
  return 0
}

/** 10. Knee extension / back knee — sagittal recurvatum, side view */
export function kneeExtensionBackKnee(side: PoseFrame): Finding {
  const key = 'knee_extension_back_knee'
  const lh = getLm(side, 'left_hip')
  const lk = getLm(side, 'left_knee')
  const la = getLm(side, 'left_ankle')
  const rh = getLm(side, 'right_hip')
  const rk = getLm(side, 'right_knee')
  const ra = getLm(side, 'right_ankle')

  const useRight = (rk?.visibility ?? 0) > (lk?.visibility ?? 0)
  const hip = useRight ? rh : lh
  const knee = useRight ? rk : lk
  const ankle = useRight ? ra : la

  if (!hip || !knee || !ankle) return makeFinding(key, 'Knee Extension', 'leg', 0, 'Neutral', 'side', 0, [])

  const conf = minVis(hip, knee, ankle)
  // This finding represents recurvatum (back-knee) specifically. angle2D is
  // unsigned [0,180], so a raw |180−angle| can't tell hyperextension from
  // flexion — facing plus the knee's side of the hip→ankle chord resolve it.
  // ONLY a confirmed posterior (hyperextended) knee is scored: the cited
  // thresholds and the downstream copy/exercises are hyperextension-specific, so
  // flexion and unverifiable-facing knees report Neutral (0°) rather than being
  // mislabeled as a back-knee or inheriting the recurvatum citation.
  const magnitude = Math.abs(180 - angle2D(hip, knee, ankle))
  let deviation = 0
  let direction = 'Neutral'
  if (magnitude >= KNEE_NEUTRAL_EPS) {
    const cross = (ankle.x - hip.x) * (knee.y - hip.y) - (ankle.y - hip.y) * (knee.x - hip.x)
    const face = sagittalFacing(side, useRight)
    if (face !== 0 && cross * face > 0) {
      deviation = magnitude
      direction = 'Hyperextended'
    }
  }

  return makeFinding(key, 'Knee Extension', 'leg', deviation, direction, 'side', conf,
    useRight ? ['right_hip','right_knee','right_ankle'] : ['left_hip','left_knee','left_ankle'])
}
