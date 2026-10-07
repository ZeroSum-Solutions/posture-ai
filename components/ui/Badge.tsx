import type { ReactNode } from 'react'
import styles from './Badge.module.css'

export type BadgeProps = {
  children: ReactNode
  className?: string
  'data-testid'?: string
}

/** Non-interactive, 24 tall, Caption, `--r-full`, flat — a count or a tag, never severity (use SeverityChip for that). */
export function Badge({ children, className, 'data-testid': testId }: BadgeProps) {
  return (
    <span className={[styles.badge, className].filter(Boolean).join(' ')} data-testid={testId}>
      {children}
    </span>
  )
}
