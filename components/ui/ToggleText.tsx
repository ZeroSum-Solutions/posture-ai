import type { ReactNode } from 'react'
import styles from './Toggle.module.css'

/**
 * Label (+ optional description) for Switch, Checkbox and Radio. The
 * description is hidden from the accessible name (the row's `<label>` names
 * the input) and reaches assistive tech through `aria-describedby` instead.
 */
export function ToggleText({ label, description, descriptionId }: { label: ReactNode; description?: ReactNode; descriptionId?: string }) {
  if (!description) return <span className={styles.label}>{label}</span>
  return (
    <span className={styles.text}>
      <span className={styles.label}>{label}</span>
      <span id={descriptionId} className={styles.description} aria-hidden="true">
        {description}
      </span>
    </span>
  )
}
