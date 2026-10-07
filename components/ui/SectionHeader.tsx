import Link from 'next/link'
import styles from './SectionHeader.module.css'

export type SectionHeaderProps = {
  title: string
  action?: { label: string; href?: string; onPress?: () => void }
  id?: string
  className?: string
  'data-testid'?: string
}

/**
 * Headline left, optional tertiary "See all" action right (48 hit). 24px
 * above, 8px below (DESIGN.md › 3.5). The `.a-quiet` utility class is the
 * tertiary-button recipe already shipped in globals.css for exactly this
 * bridge period, ahead of the controls agent's `Button` landing.
 */
export function SectionHeader({ title, action, id, className, 'data-testid': testId }: SectionHeaderProps) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(' ')} data-testid={testId}>
      <h2 id={id} className={`t-headline ${styles.title}`}>{title}</h2>
      {action ? (
        action.href ? (
          <Link href={action.href} className={`a-quiet ${styles.action}`}>{action.label}</Link>
        ) : (
          <button type="button" onClick={action.onPress} className={`a-quiet ${styles.action}`}>{action.label}</button>
        )
      ) : null}
    </div>
  )
}
