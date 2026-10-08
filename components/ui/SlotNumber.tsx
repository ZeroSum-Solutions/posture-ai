'use client'

import styles from './SlotNumber.module.css'

/**
 * A recorded value revealed digit by digit: each glyph slides up into place
 * once, staggered (DESIGN.md › Motion rule 6). It never counts through values
 * that were not recorded. The full value is the accessible text; the animated
 * glyphs are hidden from assistive tech. Re-keys on value change.
 */
export function SlotNumber({ value, className, delay = 0 }: { value: string | number; className?: string; delay?: number }) {
  const text = String(value)
  return (
    <span className={[styles.slot, className].filter(Boolean).join(' ')}>
      <span className="sr-only">{text}</span>
      <span className={styles.glyphs} aria-hidden="true" key={text}>
        {Array.from(text).map((ch, i) => (
          <span key={i} className={styles.cell}>
            <span className={styles.glyph} style={{ animationDelay: `${delay + i * 55}ms` }}>{ch}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
