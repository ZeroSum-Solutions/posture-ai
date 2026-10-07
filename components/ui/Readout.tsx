import Icon from '@/components/array/Icon'
import { BAND_LABEL } from '@/components/array/severity'
import styles from './Readout.module.css'

export type ReadoutBand = 'maintain' | 'monitor' | 'review' | 'neutral'

export type ReadoutProps = {
  label: string
  value: number | null
  unit?: string
  reference?: { min?: number; max?: number; text: string }
  band?: ReadoutBand
  size?: 'xl' | 'lg' | 'md'
  className?: string
  'data-testid'?: string
}

const BAND_THIRD: Record<ReadoutBand, number> = { maintain: 16.5, monitor: 50, review: 83.5, neutral: 50 }
const BAND_COLOR_VAR: Record<'maintain' | 'monitor' | 'review', string> = {
  maintain: 'var(--maintain)',
  monitor: 'var(--monitor)',
  review: 'var(--review)',
}

function Marker({ band }: { band: 'maintain' | 'monitor' | 'review' }) {
  const fill = BAND_COLOR_VAR[band]
  if (band === 'maintain') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill={fill} stroke="#000" strokeWidth="2" />
      </svg>
    )
  }
  if (band === 'monitor') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill={fill} stroke="#000" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5 12.8 12 1.2 12Z" fill={fill} stroke="#000" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Every measurement shows its reference range (DESIGN.md › 3.12): value line,
 * "ref ≥ 53°" caption, a 6px three-zone bar with a 14px marker shaped by band
 * (never colour alone), or "No reference yet" when there is none. The whole
 * readout is one `role="img"` with a sentence label.
 */
export function Readout({ label, value, unit, reference, band = 'neutral', size = 'md', className, 'data-testid': testId }: ReadoutProps) {
  const valueText = value != null ? `${value}${unit ? ` ${unit}` : ''}` : 'No value recorded'
  const bandWord = band !== 'neutral' ? BAND_LABEL[band] : null
  const sentence = [label, valueText, reference?.text ? `reference ${reference.text}` : 'no reference yet', bandWord]
    .filter(Boolean)
    .join(', ')

  const valueClass = size === 'xl' ? 't-readout-xl' : size === 'lg' ? 't-readout-lg' : 't-readout-md'

  return (
    <div className={[styles.readout, className].filter(Boolean).join(' ')} role="img" aria-label={sentence} data-testid={testId}>
      <span className={valueClass} style={{ color: 'var(--text-1)' }} aria-hidden="true">
        {value != null ? value : '—'}
        {unit ? <span className="t-footnote" style={{ marginLeft: 4 }}>{unit}</span> : null}
      </span>
      {reference?.text ? (
        <>
          <span className="t-footnote" aria-hidden="true">ref {reference.text}</span>
          <span className={styles.bar} aria-hidden="true">
            <span className={styles.marker} style={{ left: `${BAND_THIRD[band]}%` }}>
              <Marker band={band === 'neutral' ? 'maintain' : band} />
            </span>
          </span>
        </>
      ) : (
        <span className={styles.noRef} aria-hidden="true">
          <Icon name="info-circle-linear" size={14} />
          No reference yet
        </span>
      )}
    </div>
  )
}
