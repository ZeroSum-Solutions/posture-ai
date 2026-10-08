'use client'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { spring } from '@/lib/motion'
import styles from './FilterChip.module.css'

export type FilterChipProps = {
  label: string
  count?: number
  selected: boolean
  onToggle: () => void
  icon?: IconName
  className?: string
  'data-testid'?: string
}

/**
 * 36 tall visual, 48 hit area via `::after` (DESIGN.md › 3.4 / Chip family).
 * Selected is accent tint + accent ring + a leading check icon — white stays
 * reserved for the screen's one primary action. Never color alone.
 */
export function FilterChip({ label, count, selected, onToggle, icon, className, 'data-testid': testId }: FilterChipProps) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      whileTap={{ scale: 0.97 }}
      transition={spring.press}
      className={[styles.chip, selected ? styles.selected : '', className].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      {selected ? (
        <Icon name="check-linear" size={14} className={styles.check} />
      ) : icon ? (
        <Icon name={icon} size={14} />
      ) : null}
      <span className={styles.label}>{label}</span>
      {count == null ? null : <span className={styles.count}>{count}</span>}
    </motion.button>
  )
}

/**
 * A single-line, horizontally scrolling row of chips with edge fade masks
 * (mask-image, no blur). Chip rows never wrap (DESIGN.md › Chip family).
 */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.rowMask}>
      <div className={styles.row} role="group" aria-label={label}>
        {children}
      </div>
    </div>
  )
}
