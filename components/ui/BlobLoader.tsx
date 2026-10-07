'use client'

import { useEffect, useState } from 'react'
import { ProgressBar } from './ProgressBar'
import styles from './BlobLoader.module.css'

export interface BlobLoaderProps {
  /** Accessible name for the whole busy region, e.g. "Analyzing posture…". */
  label: string
  /** Status lines cross-fading every 1.8s below the blob (Title 2). */
  steps?: string[]
  /** Renders a ProgressBar underneath when real progress exists. */
  progress?: number
  className?: string
}

/**
 * The 56px hero loader for scan processing and other long jobs — two
 * counter-rotating layers (10s / 14s) with a spring-pulsed inner layer and a
 * 14px heartbeat core, plus a liquid-glass specular streak. See DESIGN.md ›
 * Loaders and spec §6.1.2.
 */
export function BlobLoader({ label, steps, progress, className }: BlobLoaderProps) {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (!steps || steps.length < 2) return
    const timer = setInterval(() => {
      setStepIndex(index => (index + 1) % steps.length)
    }, 1800)
    return () => clearInterval(timer)
  }, [steps])

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label={steps?.[stepIndex] ? `${label}: ${steps[stepIndex]}` : label}
      aria-busy="true"
    >
      <div className={styles.blob} aria-hidden="true">
        <div className={styles.outer} />
        <div className={styles.inner} />
        <div className={styles.core} />
      </div>
      {steps && steps.length > 0 ? (
        <div className={styles.steps} aria-hidden="true">
          {steps.map((step, index) => (
            <span key={step} className={[styles.step, index === stepIndex ? styles.stepActive : ''].filter(Boolean).join(' ')}>
              {step}
            </span>
          ))}
        </div>
      ) : null}
      {typeof progress === 'number' ? <ProgressBar value={progress} label={label} /> : null}
    </div>
  )
}
