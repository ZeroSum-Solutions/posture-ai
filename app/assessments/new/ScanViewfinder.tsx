import { Badge, Morph } from '@/components/ui'
import ViewSilhouette from './ViewSilhouette'
import { SLOT_ORDER } from './types'
import type { CaptureSlotKey } from './types'
import styles from './NewAssessment.module.css'

const SHORT_LABEL: Record<CaptureSlotKey, string> = {
  'front': 'Front',
  'side-left': 'Left',
  'side-right': 'Right',
  'back': 'Back',
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

/**
 * Decorative initials (the ui Avatar also prints the full name for screen
 * readers; here the name always sits right beside it, so it would repeat).
 */
export function Initials({ name, size = 40 }: { name: string; size?: 40 | 48 }) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = parts.length === 0 ? '?' : (parts[0]!.charAt(0) + (parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '')).toUpperCase()
  return (
    <span className={styles.initials} data-size={size} aria-hidden="true">{initials}</span>
  )
}

/**
 * The capture hero (DESIGN.md › Navigation): the dock Lens morphs into this
 * viewfinder (`<Morph name="lens" kind="lens-morph">`). It answers "who am I
 * about to scan, and what will I capture?" — the chosen client, and the four
 * required views. Its reticle corners lock on (volt) once a client is chosen.
 */
export function ScanViewfinder({
  stepLabel,
  subject,
  testMode,
}: {
  stepLabel: string
  subject: { name: string; detail?: string } | null
  testMode: boolean
}) {
  return (
    <Morph name="lens" kind="lens-morph">
      <section className={styles.viewfinder} data-ready={subject ? 'true' : undefined} aria-label="Scan setup">
        {CORNERS.map(corner => <span key={corner} className={styles.corner} data-c={corner} aria-hidden="true" />)}
        <div className={styles.vfTop}>
          <span className="t-micro">{stepLabel}</span>
          {testMode && <Badge>TEST MODE</Badge>}
        </div>
        {subject ? (
          <div key={subject.name} role="status" data-testid="selected-client-summary" className={styles.vfSubject}>
            <Initials name={subject.name} size={48} />
            <span className={styles.vfSubjectText}>
              <span className="sr-only">Selected client: </span>
              <strong className={`t-title ${styles.vfName}`}>{subject.name}</strong>
              {subject.detail && <span className="t-label">{subject.detail}</span>}
            </span>
          </div>
        ) : (
          <div className={styles.vfSubject}>
            <p className={`t-headline ${styles.vfPrompt}`}>Who are you scanning?</p>
          </div>
        )}
        <ol className={styles.vfViews} aria-label="Four views to capture">
          {SLOT_ORDER.map(slot => (
            <li key={slot} className={styles.vfView}>
              <ViewSilhouette slot={slot} size={24} />
              <span className="t-micro">{SHORT_LABEL[slot]}</span>
            </li>
          ))}
        </ol>
      </section>
    </Morph>
  )
}
