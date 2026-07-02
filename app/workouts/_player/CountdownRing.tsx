'use client'
import type { ReactNode } from 'react'

/**
 * Circular countdown ring for the workout player. `progress` is the fraction of
 * time REMAINING (1 = full ring, 0 = depleted); the colored arc shrinks as the
 * hold counts down. Center content (the big seconds readout or a rep target) is
 * rendered as `children` over the SVG.
 */
export function CountdownRing({
  progress,
  color,
  size = 264,
  strokeWidth = 12,
  children,
  dimmed = false,
}: {
  progress: number
  color: string
  size?: number
  strokeWidth?: number
  children: ReactNode
  dimmed?: boolean
}) {
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circumference * (1 - clamped)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)', display: 'block' }}
        aria-hidden="true"
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.25s linear',
            opacity: dimmed ? 0.5 : 1,
            filter: `drop-shadow(0 0 10px ${color}66)`,
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 2,
        }}
      >
        {children}
      </div>
    </div>
  )
}
