import styles from './DotsBounce.module.css'

export interface DotsBounceProps {
  /** Dot diameter. Button labels use 6; standalone "Saving…" rows use 8. */
  size?: 6 | 8
  /** Accessible name; the dots live inside an element that already announces busy. */
  label?: string
  className?: string
}

/**
 * Three dots bouncing in a spring-like stagger — the inline loader for button
 * labels, toasts and "Saving…" rows. See DESIGN.md › Loaders and spec §6.1.4.
 *
 * Pure CSS (no framer): three staggered `animation-delay`s let the compositor
 * drive the loop, and `prefers-reduced-motion` swaps the bounce for a gentle
 * opacity pulse via the sibling `@media` block in DotsBounce.module.css.
 */
export function DotsBounce({ size = 8, label, className }: DotsBounceProps) {
  return (
    <span
      className={[styles.row, className].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {[0, 1, 2].map(index => (
        <span key={index} className={styles.dot} style={{ width: size, height: size }} />
      ))}
    </span>
  )
}
