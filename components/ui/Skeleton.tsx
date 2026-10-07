import type { CSSProperties } from 'react'
import styles from './Skeleton.module.css'

export type SkeletonShape = 'line' | 'row' | 'card' | 'avatar' | 'thumb'

export interface SkeletonProps {
  shape?: SkeletonShape
  /** For `shape="line"`: stacks this many lines, each a little shorter than the last. */
  lines?: number
  className?: string
  style?: CSSProperties
}

const shapeClass: Record<SkeletonShape, string> = {
  line: styles.line,
  row: styles.row,
  card: styles.card,
  avatar: styles.avatar,
  thumb: styles.thumb,
}

const lineWidths = ['100%', '85%', '70%', '92%', '60%']

/**
 * A layout-matched loading placeholder. Shimmer comes from the shared global
 * `.skeleton` class (app/globals.css) so every skeleton on a screen sweeps on
 * one clock. Lists and cards show this instead of a lone spinner (brief §4).
 */
export function Skeleton({ shape = 'line', lines = 1, className, style }: SkeletonProps) {
  if (shape === 'line' && lines > 1) {
    return (
      <div className={styles.lineGroup} aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={['skeleton', styles.line, className].filter(Boolean).join(' ')}
            style={{ width: lineWidths[index % lineWidths.length], ...style }}
          />
        ))}
      </div>
    )
  }

  return <div aria-hidden="true" className={['skeleton', shapeClass[shape], className].filter(Boolean).join(' ')} style={style} />
}

/** 40 avatar + two lines, 64 tall — the standard ListRow placeholder. */
export function ListRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={[styles.listRow, className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className={['skeleton', styles.avatar].join(' ')} />
      <div className={styles.listRowLines}>
        <div className={['skeleton', styles.listRowLine1].join(' ')} />
        <div className={['skeleton', styles.listRowLine2].join(' ')} />
      </div>
    </div>
  )
}

/** A hero-card-shaped placeholder: a thumb plus two shimmering lines. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={[styles.cardSkeleton, className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className={['skeleton', styles.thumb].join(' ')} />
      <div className={['skeleton', styles.cardSkeletonBody].join(' ')} />
      <div className={['skeleton', styles.cardSkeletonBody].join(' ')} style={{ width: '45%' }} />
    </div>
  )
}
