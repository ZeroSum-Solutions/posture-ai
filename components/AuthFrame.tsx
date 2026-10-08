import Link from 'next/link'
import type { ReactNode } from 'react'
import Lens from './ui/Lens'
import styles from './AuthFrame.module.css'

/**
 * The shell every auth screen sits in.
 *
 * Array v4: content sits on the canvas (no card) — the Lens + wordmark,
 * a micro eyebrow, the display title, then the fields and one volt action.
 *
 * Phone-first: the marketing column only appears once there is room for it, so
 * on the device a practitioner actually signs in on there is one column, the
 * fields are the widest thing on screen, and nothing competes with them. The
 * previous layout put a story panel above the form on a phone, which pushed the
 * password field and the MFA code input below the fold.
 */
export default function AuthFrame({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className={styles.layout}>
      <aside className={styles.story}>
        <h2 className={styles.storyHeading}>Clarity at every point of the screen.</h2>
        <p className={styles.storyCopy}>
          Consistent capture, focused review, and a practical next step for every
          client conversation.
        </p>
      </aside>

      <div className={styles.column}>
        <Link href="/" className={styles.brand} aria-label="Posture AI home">
          <Lens size={36} tone="ghost" />
          <span>Posture AI</span>
        </Link>
        <div className={styles.head}>
          <p className="t-micro">Secure workspace</p>
          <h1 className={`t-display ${styles.title}`}>{title}</h1>
          <p className={`t-callout ${styles.description}`}>{description}</p>
        </div>
        <div className={styles.body}>
          {children}
        </div>
      </div>
    </div>
  )
}
