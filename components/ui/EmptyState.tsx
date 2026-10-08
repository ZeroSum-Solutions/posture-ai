import Link from 'next/link'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import Lens from './Lens'
import styles from './EmptyState.module.css'

type Action = { label: string; href?: string; onPress?: () => void }

export type EmptyStateProps = {
  icon: IconName
  title: string
  body: string
  primary?: Action
  secondary?: Action
  variant?: 'page' | 'inline'
  /**
   * The mark above the headline. `lens` (page default): a 64px ghost Lens —
   * the app's signature object, idle and breathing. `icon` (inline default):
   * the given line glyph, no tile.
   */
  art?: 'lens' | 'icon'
  className?: string
  'data-testid'?: string
}

function ActionButton({ action, kind }: { action: Action; kind: 'primary' | 'secondary' }) {
  const cls = kind === 'primary' ? 'a-primary' : 'a-quiet'
  return action.href ? (
    <Link href={action.href} className={`${cls} ${styles.action}`}>{action.label}</Link>
  ) : (
    <button type="button" onClick={action.onPress} className={`${cls} ${styles.action}`}>{action.label}</button>
  )
}

/**
 * Array v4 empty state (DESIGN.md › Principles: one answer, one action):
 * a mark (ghost Lens on a page, a line glyph inline), a headline, one
 * sentence of why it's empty, and one primary action plus an optional quiet
 * one. Set straight on the canvas — no tile, no card. The parts rise in on a
 * 30ms stagger (opacity + transform; none under reduced motion).
 */
export function EmptyState({ icon, title, body, primary, secondary, variant = 'page', art, className, 'data-testid': testId }: EmptyStateProps) {
  const mark = art ?? (variant === 'page' ? 'lens' : 'icon')
  return (
    <div className={[styles.empty, variant === 'inline' ? styles.inline : styles.page, className].filter(Boolean).join(' ')} data-testid={testId}>
      <span className={styles.mark} aria-hidden="true">
        {mark === 'lens' ? <Lens size={64} tone="ghost" breathing /> : <Icon name={icon} size={variant === 'inline' ? 28 : 32} />}
      </span>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
      {primary || secondary ? (
        <div className={styles.actions}>
          {primary ? <ActionButton action={primary} kind="primary" /> : null}
          {secondary ? <ActionButton action={secondary} kind="secondary" /> : null}
        </div>
      ) : null}
    </div>
  )
}
