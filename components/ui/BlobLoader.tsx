'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Lens from './Lens'
import { ProgressBar } from './ProgressBar'
import styles from './BlobLoader.module.css'

export interface BlobLoaderProps {
  /** Accessible name for the whole busy region, e.g. "Analyzing posture…". */
  label: string
  /** Status lines that roll upward every 1.8s below the Lens. */
  steps?: string[]
  /** Renders a ProgressBar underneath when real progress exists. */
  progress?: number
  /** Lens size in px. Default 56. */
  size?: number
  className?: string
}

const STEP_MS = 1800

/**
 * The Lens loader (DESIGN.md › Loaders) for jobs over a second — scan
 * processing and other long work. The Lens morphs squircle ⇄ circle on the
 * jelly spring while its reticle turns, and a volt scan sweep orbits it on a
 * hairline track (one rotating layer, transform only). Status steps roll up
 * like a ticker (transform + opacity); a real `progress` adds a ProgressBar.
 * Under reduced motion the sweep and the roll stop and the Lens holds still;
 * the steps swap with a fade.
 *
 * Kept under its v3 name so call sites need no change.
 */
export function BlobLoader({ label, steps, progress, size = 56, className }: BlobLoaderProps) {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (!steps || steps.length < 2) return
    const timer = setInterval(() => {
      setStepIndex(index => (index + 1) % steps.length)
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [steps])

  const count = steps?.length ?? 0

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label={steps?.[stepIndex] ? `${label}: ${steps[stepIndex]}` : label}
      aria-busy="true"
    >
      <div className={styles.stage} style={{ '--lens-stage': `${size}px` } as CSSProperties} aria-hidden="true">
        <span className={styles.track} />
        <span className={styles.sweep} />
        <Lens size={size} state="loading" />
      </div>
      {count > 0 ? (
        <div className={styles.steps} aria-hidden="true">
          {steps!.map((step, index) => {
            const offset = (index - stepIndex + count) % count
            const pos = offset === 0 ? 'now' : offset === count - 1 ? 'past' : 'next'
            return (
              <span key={step} className={styles.step} data-pos={pos}>
                {step}
              </span>
            )
          })}
        </div>
      ) : null}
      {typeof progress === 'number' ? (
        <div className={styles.progress}>
          <ProgressBar value={progress} label={label} />
        </div>
      ) : null}
    </div>
  )
}
