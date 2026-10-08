import styles from './Lens.module.css'

export type LensState = 'idle' | 'loading' | 'done'

/**
 * The Lens — Array v4's signature object (DESIGN.md › Navigation, Loaders).
 * A volt squircle with a scan reticle. `breathing` gives it a slow idle pulse
 * (the dock); `state="loading"` morphs it between circle and rounded square
 * while the reticle turns (the long-job loader); `state="done"` blooms it once
 * and swaps the reticle for a check (scan complete). Decorative by default:
 * the surrounding control carries the accessible name.
 */
export default function Lens({
  size = 52,
  breathing = false,
  state = 'idle',
  tone = 'volt',
  className,
}: {
  size?: number
  breathing?: boolean
  state?: LensState
  /** `ghost` draws the Lens as a volt outline on dark (inline loaders). */
  tone?: 'volt' | 'ghost'
  className?: string
}) {
  return (
    <span
      className={[styles.lens, className].filter(Boolean).join(' ')}
      data-state={state}
      data-breathing={breathing && state === 'idle' ? 'true' : undefined}
      data-tone={tone}
      style={{ '--lens-size': `${size}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg className={styles.reticle} viewBox="0 0 24 24" fill="none">
        {state === 'done' ? (
          <path className={styles.check} d="M6.5 12.5l3.6 3.6L17.6 8.4" />
        ) : (
          <>
            <path d="M4 9V6.5A2.5 2.5 0 0 1 6.5 4H9M15 4h2.5A2.5 2.5 0 0 1 20 6.5V9M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 20H6.5A2.5 2.5 0 0 1 4 17.5V15" />
            <circle className={styles.pupil} cx="12" cy="12" r="2.4" />
          </>
        )}
      </svg>
    </span>
  )
}
