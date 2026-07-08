'use client'

import { useMemo } from 'react'
import styles from './MarketingHome.module.css'

type Point = {
  id: string
  x: number
  y: number
  radius: number
  opacity: number
  tone: 'primary' | 'copper'
}

type Segment = [number, number, number, number, number, number]

const segments: Segment[] = [
  [252, 74, 252, 74, 26, 420],
  [244, 102, 222, 152, 11, 160],
  [219, 158, 208, 242, 27, 650],
  [224, 168, 232, 240, 8, 140],
  [232, 240, 238, 300, 6.5, 100],
  [208, 242, 213, 266, 24, 220],
  [213, 266, 218, 368, 16, 310],
  [218, 368, 212, 500, 10, 220],
  [212, 500, 242, 508, 6, 70],
]

function mulberry32(seed: number) {
  return function random() {
    let nextSeed = seed
    nextSeed |= 0
    nextSeed = (nextSeed + 0x6d2b79f5) | 0
    let t = Math.imul(nextSeed ^ (nextSeed >>> 15), 1 | nextSeed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    seed = nextSeed
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildPoints() {
  const random = mulberry32(20260706)
  const points: Point[] = []
  const gaussian = () => (random() + random() + random() - 1.5) / 1.5

  function addPoint(x: number, y: number, edge: number) {
    points.push({
      id: `p-${points.length}`,
      x,
      y,
      radius: 0.62 + random() * 1.1,
      opacity: 0.14 + (1 - edge) * 0.38 + random() * 0.18,
      tone: random() < 0.08 ? 'copper' : 'primary',
    })
  }

  for (const [x1, y1, x2, y2, halfWidth, count] of segments) {
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)

    for (let index = 0; index < count; index += 1) {
      if (length < 8) {
        const angle = random() * Math.PI * 2
        const radius = halfWidth * Math.sqrt(random())
        addPoint(
          x1 + Math.cos(angle) * radius + gaussian() * 1.2,
          y1 + Math.sin(angle) * radius + gaussian() * 1.2,
          radius / halfWidth,
        )
      } else {
        const t = random()
        const centerX = x1 + dx * t
        const centerY = y1 + dy * t
        const perpendicularX = -dy / length
        const perpendicularY = dx / length
        const offset = gaussian() * halfWidth
        addPoint(
          centerX + perpendicularX * offset + gaussian() * 1.5,
          centerY + perpendicularY * offset + gaussian() * 1.5,
          Math.min(1, Math.abs(offset) / halfWidth),
        )
      }
    }
  }

  return points
}

export function PointCloudFigure() {
  const points = useMemo(() => buildPoints(), [])

  return (
    <svg
      className={styles.pointCloudSvg}
      viewBox="0 0 440 560"
      role="img"
      aria-label="Standing side-profile body rendered as a posture point cloud with a plumb line and two angle annotations."
    >
      <defs>
        <mask id="marketingFigureMask" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="440" height="560" className={styles.maskOut} />
          <circle cx="252" cy="74" r="27" className={styles.maskIn} />
          <path d="M244 102 L222 152" className={styles.maskStrokeNeck} />
          <path d="M219 158 L208 242" className={styles.maskStrokeTorso} />
          <path d="M224 168 L232 240" className={styles.maskStrokeArmUpper} />
          <path d="M232 240 L238 300" className={styles.maskStrokeArmLower} />
          <path d="M208 242 L213 266" className={styles.maskStrokePelvis} />
          <path d="M213 266 L218 368" className={styles.maskStrokeThigh} />
          <path d="M218 368 L212 500" className={styles.maskStrokeShin} />
          <path d="M212 500 L242 508" className={styles.maskStrokeFoot} />
        </mask>
      </defs>

      <line x1="212" y1="28" x2="212" y2="528" className={styles.plumbLine} />
      <circle cx="212" cy="530" r="6" className={styles.plumbAnchor} />

      <g aria-hidden="true" mask="url(#marketingFigureMask)">
        <line x1="78" y1="0" x2="330" y2="0" className={styles.scanLine} />
      </g>

      <g aria-hidden="true">
        {points.map((point) => (
          <circle
            key={point.id}
            cx={point.x}
            cy={point.y}
            r={point.radius}
            opacity={point.opacity}
            className={point.tone === 'copper' ? styles.dotCopper : styles.dotPrimary}
          />
        ))}
      </g>

      <polyline points="252,86 218,158 208,242 218,368 212,506" className={styles.skeletalLine} />
      <g aria-hidden="true">
        <circle cx="252" cy="80" r="5" className={styles.landmarkStrong} />
        <circle cx="218" cy="158" r="5" className={styles.landmark} />
        <circle cx="208" cy="242" r="5" className={styles.landmark} />
        <circle cx="218" cy="368" r="5" className={styles.landmark} />
        <circle cx="212" cy="506" r="5" className={styles.landmark} />
      </g>

      <line x1="218" y1="158" x2="218" y2="108" className={styles.angleGuide} />
      <path d="M 218 118 A 40 40 0 0 1 236 122" className={styles.angleArc} />
      <text x="252" y="116" className={styles.angleValue}>12.4&deg;</text>
      <text x="252" y="134" className={styles.angleLabel}>FORWARD HEAD</text>

      <line x1="208" y1="242" x2="208" y2="196" className={styles.angleGuide} />
      <path d="M 208 206 A 36 36 0 0 1 215 207" className={styles.angleArcCopper} />
      <text x="184" y="207" textAnchor="end" className={styles.angleValueCopper}>4.2&deg;</text>
      <text x="184" y="225" textAnchor="end" className={styles.angleLabel}>TRUNK SHIFT</text>
    </svg>
  )
}
