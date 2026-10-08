import styles from './Avatar.module.css'

export type AvatarProps = {
  name: string
  size?: 40 | 48 | 72
  /** Tints the ring (e.g. a severity or grade band colour). Defaults to the hairline. */
  ringColor?: string
  className?: string
  'data-testid'?: string
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]!.charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : ''
  return (first + last).toUpperCase()
}

/** 40/48/72, initials, `--r-full`; an optional ring (DESIGN.md › 3.15). */
export function Avatar({ name, size = 40, ringColor, className, 'data-testid': testId }: AvatarProps) {
  const fontSize = size <= 40 ? 'var(--t-subhead)' : size <= 48 ? 'var(--t-headline)' : 'var(--t-title-2)'
  return (
    <span
      className={[styles.avatar, className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        boxShadow: `inset 0 0 0 1.5px ${ringColor ?? 'var(--hairline)'}`,
        font: fontSize,
      }}
      data-testid={testId}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  )
}
