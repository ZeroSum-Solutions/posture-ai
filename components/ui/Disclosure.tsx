'use client'
import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Icon from '@/components/array/Icon'
import { spring, reduced } from '@/lib/motion'
import styles from './Disclosure.module.css'

export type DisclosureProps = {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  'data-testid'?: string
}

/**
 * Replaces the "Accuracy & methodology ↓" glass-card pattern (DESIGN.md ›
 * 3.15). A 48px row; the chevron rotates on `spring.state`, content height
 * animates on `spring.layout`. `prefers-reduced-motion` drops both to the
 * 150ms `reduced` fade — no rotation, no height spring.
 */
export function Disclosure({ title, children, defaultOpen = false, open: openProp, onOpenChange, className, 'data-testid': testId }: DisclosureProps) {
  const [openState, setOpenState] = useState(defaultOpen)
  const open = openProp ?? openState
  const contentId = useId()
  const reduceMotion = useReducedMotion()

  function toggle() {
    const next = !open
    if (onOpenChange) onOpenChange(next)
    if (openProp === undefined) setOpenState(next)
  }

  return (
    <div className={[styles.disclosure, className].filter(Boolean).join(' ')} data-testid={testId}>
      <button type="button" className={styles.trigger} aria-expanded={open} aria-controls={contentId} onClick={toggle}>
        <span className="t-headline" style={{ color: 'var(--text-1)' }}>{title}</span>
        <motion.span
          className={styles.chevron}
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduceMotion ? reduced : spring.state}
        >
          <Icon name="alt-arrow-down-linear" size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? reduced : spring.layout}
            className={styles.content}
          >
            <div className={styles.contentInner}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
