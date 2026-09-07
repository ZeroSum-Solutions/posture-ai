import type { PoseFrame } from '@posture-ai/engine'
import styles from './ScanExperience.module.css'

const CONNECTIONS = [
  ['left_ear', 'left_shoulder'], ['right_ear', 'right_shoulder'],
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ['left_ankle', 'left_foot_index'], ['right_ankle', 'right_foot_index'],
] as const

/** Image and landmarks occupy one uncropped coordinate plane for every view. */
export default function ScanVisual({ frame, image, sample = false }: {
  frame: PoseFrame
  image?: string
  sample?: boolean
}) {
  // Match the engine's square-coordinate default for historical/sample frames.
  const ratio = frame.aspectRatio ?? 1
  const width = 300 * ratio
  const points = frame.landmarks
  const visible = (name: string) => points[name] && (points[name].visibility ?? 1) >= 0.5
  const names = [...new Set(CONNECTIONS.flat())].filter(visible)
  return (
    <div className={styles.visual}>
      <svg viewBox={`0 0 ${width} 300`} role="img" aria-label={`${frame.view} ${sample ? 'synthetic sample' : image ? 'capture with pose overlay' : 'saved landmark reconstruction'}`}>
        {image ? <image href={image} width={width} height={300} preserveAspectRatio="none" /> : null}
        <line x1={width / 2} x2={width / 2} y1="0" y2="300" stroke="var(--text-tertiary)" strokeDasharray="2 6" opacity="0.6" />
        {[0.25, 0.5, 0.75].map(y => <line key={y} x1="0" x2={width} y1={y * 300} y2={y * 300} stroke="var(--hairline)" />)}
        {!image ? CONNECTIONS.filter(([a, b]) => visible(a) && visible(b)).map(([a, b]) => (
          <line key={`body-${a}-${b}`} x1={points[a].x * width} y1={points[a].y * 300} x2={points[b].x * width} y2={points[b].y * 300} stroke="var(--text-primary)" strokeOpacity="0.16" strokeWidth="12" strokeLinecap="round" />
        )) : null}
        {CONNECTIONS.filter(([a, b]) => visible(a) && visible(b)).map(([a, b]) => (
          <line key={`${a}-${b}`} x1={points[a].x * width} y1={points[a].y * 300} x2={points[b].x * width} y2={points[b].y * 300} stroke="var(--maintain)" strokeWidth="1.25" />
        ))}
        {names.map(name => <circle key={name} cx={points[name].x * width} cy={points[name].y * 300} r="2.5" fill="var(--action)" stroke="var(--maintain)" strokeWidth="1" />)}
      </svg>
      <span className={styles.viewLabel}>{frame.view === 'front' ? 'Front' : 'Side profile'}</span>
    </div>
  )
}
