'use client'
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
 * v4 wizard progress (DESIGN.md › Navigation, the dock's stretch): one pill
 * per step. The current step's pill is wider — it grows on the spring curve
 * (flex-grow, no layout reads) as the wizard advances — and carries the volt
 * "now" fill, which sweeps in from the left; done steps settle to ink-2;
 * upcoming steps are empty wells. "Step 2 of 3 · Capture" is always in words,
 * never colour alone.
 */
export function Stepper({ steps, current, onBack, className, 'data-testid': testId }: StepperProps) {
  const currentIndex = Math.max(0, steps.findIndex((s) => s.id === current))
  const currentStep = steps[currentIndex]

  return (
    <div className={[styles.stepper, className].filter(Boolean).join(' ')} data-testid={testId}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Progress"
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
              data-state={state}
              aria-label={canTap ? `Back to ${step.label}` : undefined}
              onClick={canTap ? () => onBack?.(step.id) : undefined}
            >
              <span className={styles.well} aria-hidden="true">
                <span className={styles.fill} />
              </span>
            </Segment>
          )
        })}
      </div>
      <p className={styles.caption}>
        Step {currentIndex + 1} of {steps.length} · {currentStep?.label}
      </p>
    </div>
  )
}
