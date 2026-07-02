export interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export type ViewLabel = 'front' | 'side' | 'back'

export interface PoseFrame {
  view: ViewLabel
  landmarks: Record<string, Landmark>
  /**
   * Signed camera roll in degrees, measured by device sensors at the capture
   * instant. Present only for sensor-verified live captures. Positive = the
   * phone's top edge was tilted to the photographer's right.
   */
  captureRollDeg?: number
  /** Image width / height (e.g. 0.75 for 720×960 portrait). */
  aspectRatio?: number
  /** How the frame was produced; uploads can never be sensor-verified. */
  source?: 'camera' | 'upload'
}

export type Zone = 'maintain' | 'warning' | 'danger' | 'unreliable'
export type OverallGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export interface Finding {
  key: string
  label: string
  region: 'head_shoulders' | 'spine' | 'pelvis' | 'leg'
  deviation: number
  standard: number
  unit: string
  direction: string
  severityPct: number
  zone: Zone
  viewUsed: ViewLabel
  confidence: number
  reliable: boolean
  landmarksUsed: string[]
  /**
   * Within-capture stability of THIS finding's deviation across the capture
   * burst, 0..1 (1 = rock-steady). Present only for multi-frame captures; a
   * single frame carries no spread, so it is left undefined (never fabricated).
   * This is detector/landmark stability within one capture — NOT test-retest
   * repeatability, which would require re-positioning between captures.
   */
  stabilityScore?: number
  /** Robust 1σ (degrees) of this finding's deviation across the burst; undefined for a single frame. */
  uncertaintyDeg?: number
}

export interface AssessmentResult {
  findings: Finding[]
  overallScore: number
  overallGrade: OverallGrade
  overallPercentile: number
  ranks: { front: number | null; side: number | null }
  generatedAt: string
  engineVersion: string
  disclaimer: string
  missingViews: ViewLabel[]
  /** True when at least one frame carried a non-zero measured camera roll that was removed. */
  tiltCorrected: boolean
  /** True when every submitted frame came from sensor-verified capture (captureRollDeg present and not an upload). */
  levelVerified: boolean
  /**
   * Mean within-capture stability (0..1) of the reliable findings that had a
   * multi-frame burst; null when the capture was single-frame per view (every
   * legacy assessment) so it is never fabricated from one sample.
   */
  captureStability?: number | null
}
