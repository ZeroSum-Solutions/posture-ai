'use client'
import type { CSSProperties, ReactNode } from 'react'
import styles from './CountdownRing.module.css'

const TICKS = 60

/**
 * The player's timing dial (Array v4 "instrument"). `progress` is the fraction
 * of time REMAINING (1 = full, 0 = depleted). A 60-tick bezel stays lit for the
 * time that is left, the coloured arc shrinks with it, and a volt "now" head
 * rides the arc's leading end (DESIGN.md › volt = the now marker). Centre
 * content (the big seconds readout) is rendered as `children` over the SVG.
 * The API is unchanged so the strength RestTimer keeps working.
 */
export function CountdownRing({
  progress,
  color,
  size = 288,
  strokeWidth = 6,
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
  const box = 300
  const r = 124
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circumference * (1 - clamped)
  const lit = Math.ceil(clamped * TICKS)
  const showTicks = size >= 200
  const scaledStroke = strokeWidth * (box / size)

  return (
    <div
      className={styles.dial}
      style={{ width: size, height: size, '--dial-color': color } as CSSProperties}
      data-dimmed={dimmed ? 'true' : undefined}
    >
      <svg viewBox={`0 0 ${box} ${box}`} className={styles.svg} aria-hidden="true">
        {showTicks ? (
          <g>
            {Array.from({ length: TICKS }).map((_, i) => {
              const major = i % 5 === 0
              return (
                <line
                  key={i}
                  x1={box / 2}
                  y1={major ? 4 : 8}
                  x2={box / 2}
                  y2={16}
                  transform={`rotate(${(i * 360) / TICKS} ${box / 2} ${box / 2})`}
                  className={styles.tick}
                  data-lit={i < lit ? 'true' : undefined}
                  data-major={major ? 'true' : undefined}
                />
              )
            })}
          </g>
        ) : null}
        <g transform={`rotate(-90 ${box / 2} ${box / 2})`}>
          <circle cx={box / 2} cy={box / 2} r={r} fill="none" className={styles.track} strokeWidth={scaledStroke} />
          <circle
            cx={box / 2}
            cy={box / 2}
            r={r}
            fill="none"
            stroke="var(--dial-color)"
            strokeWidth={scaledStroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={styles.arc}
          />
        </g>
        {clamped > 0 && clamped < 1 ? (
          <g className={styles.headGroup} style={{ transform: `rotate(${clamped * 360}deg)` }}>
            <circle cx={box / 2} cy={box / 2 - r} r={scaledStroke * 1.15} className={styles.head} />
          </g>
        ) : null}
      </svg>
      <div className={styles.centre}>{children}</div>
    </div>
  )
}
