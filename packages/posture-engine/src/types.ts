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
}
