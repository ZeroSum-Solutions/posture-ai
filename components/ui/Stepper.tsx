'use client'
import { motion, useReducedMotion } from 'framer-motion'
import { spring, reduced } from '@/lib/motion'
import styles from './Stepper.module.css'

export type StepperStep = { id: string; label: string }

export type StepperProps = {
  steps: StepperStep[]
  current: string
  /** Completed steps are tappable only where going back is safe — pass this to allow it. */
  onBack?: (id: string) => void
  className?: string
  'data-testid'?: string
}

/**
 * The capture-wizard progress track: a 4px bar split per step, the current
 * segment springing to fill, plus "Step 2 of 3 · Capture" so the step name
 * is always in words, never colour alone (DESIGN.md › 3.14).
 */
export function Stepper({ steps, current, onBack, className, 'data-testid': testId }: StepperProps) {
  const currentIndex = Math.max(0, steps.findIndex((s) => s.id === current))
  const currentStep = steps[currentIndex]
  const reduceMotion = useReducedMotion()

  return (
    <div className={[styles.stepper, className].filter(Boolean).join(' ')} data-testid={testId}>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={currentIndex + 1}
        aria-valuetext={`Step ${currentIndex + 1} of ${steps.length}, ${currentStep?.label ?? ''}`}
      >
        {steps.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
          const canTap = state === 'done' && !!onBack
          const Segment = canTap ? 'button' : 'div'
          return (
            <Segment
              key={step.id}
              type={canTap ? 'button' : undefined}
              className={styles.segment}
              aria-label={canTap ? `Back to ${step.label}` : undefined}
              onClick={canTap ? () => onBack?.(step.id) : undefined}
            >
              <motion.span
                className={styles.fill}
                initial={false}
                animate={{ width: state === 'upcoming' ? '0%' : '100%' }}
                transition={reduceMotion ? reduced : spring.layout}
              />
            </Segment>
          )
        })}
      </div>
      <p className="t-subhead" style={{ marginTop: 'var(--s-8)' }}>
        Step {currentIndex + 1} of {steps.length} · {currentStep?.label}
      </p>
    </div>
  )
}
