import Link from 'next/link'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import styles from './EmptyState.module.css'

type Action = { label: string; href?: string; onPress?: () => void }

export type EmptyStateProps = {
  icon: IconName
  title: string
  body: string
  primary?: Action
  secondary?: Action
  variant?: 'page' | 'inline'
  className?: string
  'data-testid'?: string
}

function ActionButton({ action, kind }: { action: Action; kind: 'primary' | 'secondary' }) {
  const cls = kind === 'primary' ? 'a-primary' : 'a-secondary'
  return action.href ? (
    <Link href={action.href} className={cls}>{action.label}</Link>
  ) : (
    <button type="button" onClick={action.onPress} className={cls}>{action.label}</button>
  )
}

/**
 * 56px icon tile → Title → Body (≤2 lines) → one primary action + optional
 * tertiary (DESIGN.md › 3.11). Always says why it's empty and the next step.
 * `inline` is used for "No photo for this view".
 */
export function EmptyState({ icon, title, body, primary, secondary, variant = 'page', className, 'data-testid': testId }: EmptyStateProps) {
  return (
    <div className={[styles.empty, variant === 'inline' ? styles.inline : styles.page, className].filter(Boolean).join(' ')} data-testid={testId}>
      <span className={styles.icon}>
        <Icon name={icon} size={variant === 'inline' ? 22 : 26} />
      </span>
      <h2 className={variant === 'inline' ? 't-title-2' : 't-title-1'}>{title}</h2>
      <p className="t-body" style={{ color: 'var(--text-2)' }}>{body}</p>
      {primary || secondary ? (
        <div className={styles.actions}>
          {primary ? <ActionButton action={primary} kind="primary" /> : null}
          {secondary ? <ActionButton action={secondary} kind="secondary" /> : null}
        </div>
      ) : null}
    </div>
  )
}
