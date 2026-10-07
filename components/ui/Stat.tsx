import Icon from '@/components/array/Icon'
import { deltaBand, deltaIcon, formatDelta, tone } from '@/components/array/severity'
import styles from './Stat.module.css'

export type StatProps = {
  label: string
  value: string | number | null
  unit?: string
  size?: 'lg' | 'md'
  /** `goodDirection` tells the delta which way is an improvement — colour follows that, not the sign. */
  delta?: { value: number; goodDirection?: 'up' | 'down'; compareLabel?: string }
  className?: string
  'data-testid'?: string
}

/** Label (Footnote) / value (Readout L|M) / unit / optional delta (DESIGN.md › 3.12). */
export function Stat({ label, value, unit, size = 'md', delta, className, 'data-testid': testId }: StatProps) {
  const lowerIsBetter = (delta?.goodDirection ?? 'down') === 'down'
  const band = delta ? deltaBand(delta.value, lowerIsBetter) : 'neutral'
  const deltaText = delta ? formatDelta(delta.value) : null

  return (
    <div className={[styles.stat, className].filter(Boolean).join(' ')} data-testid={testId}>
      <span className="t-footnote">{label}</span>
      <span className={size === 'lg' ? 't-readout-lg' : 't-readout-md'} style={{ color: 'var(--text-1)' }}>
        {value ?? '—'}
        {unit ? <span className="t-footnote" style={{ marginLeft: 4 }}>{unit}</span> : null}
      </span>
      {delta && deltaText ? (
        <span className={styles.delta} style={{ color: tone(band) }}>
          <Icon name={deltaIcon(delta.value)} size={12} />
          {deltaText}
          <span className="sr-only">
            {delta.value < 0 ? 'down' : 'up'} {Math.abs(delta.value)} {delta.compareLabel ?? 'vs last scan'}
          </span>
        </span>
      ) : null}
    </div>
  )
}
