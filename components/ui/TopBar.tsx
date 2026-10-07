'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from '@/components/array/Icon'
import { spring } from '@/lib/motion'
import styles from './TopBar.module.css'

export interface TopBarProps {
  title: string
  subtitle?: string
  back?: { href: string; label: string }
  actions?: ReactNode
  /** @default true */
  large?: boolean
}

/**
 * Large-title collapse (spec §3.6). The large title is the page's `<h1>`;
 * when `large` is false there is no large zone, so the collapsed bar's title
 * takes the `<h1>` instead — exactly one heading either way.
 *
 * Back and actions are duplicated across the two zones (one is always
 * visually hidden behind the other), so whichever copy isn't currently shown
 * is `inert`: out of the accessibility tree and tab order, so a query by name
 * (or a keyboard user) only ever finds the one that's visible.
 */
export default function TopBar({ title, subtitle, back, actions, large = true }: TopBarProps) {
  const [collapsed, setCollapsed] = useState(!large)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!large) return
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [large])

  // Only meaningful while `large` is true: otherwise there is a single copy
  // of each, so neither is ever inert.
  const collapsedChromeInert = large && !collapsed
  const largeChromeInert = large && collapsed

  function renderBack(inert: boolean) {
    if (!back) return null
    return (
      <Link
        href={back.href}
        aria-label={back.label}
        className={styles.backButton}
        inert={inert}
        aria-hidden={inert || undefined}
      >
        <Icon name="alt-arrow-left-linear" size={20} />
      </Link>
    )
  }

  return (
    <>
      <div className={[styles.collapsed, collapsed ? styles.collapsedVisible : ''].filter(Boolean).join(' ')}>
        <div className={styles.collapsedInner}>
          {renderBack(collapsedChromeInert)}
          {large ? (
            <motion.span
              className={styles.collapsedTitle}
              initial={false}
              animate={{ opacity: collapsed ? 1 : 0 }}
              transition={spring.state}
            >
              {title}
            </motion.span>
          ) : (
            <h1 className={styles.collapsedTitle}>{title}</h1>
          )}
          {actions && (
            <div className={styles.actions} inert={collapsedChromeInert} aria-hidden={collapsedChromeInert || undefined}>
              {actions}
            </div>
          )}
        </div>
      </div>

      {large && (
        <div className={styles.largeWrap}>
          <div className={styles.largeHeader}>
            {renderBack(largeChromeInert)}
            {actions && (
              <div className={styles.actions} inert={largeChromeInert} aria-hidden={largeChromeInert || undefined}>
                {actions}
              </div>
            )}
          </div>
          <h1 className={`${styles.largeTitle} t-display`}>{title}</h1>
          {subtitle && <p className={`${styles.subtitle} t-body`}>{subtitle}</p>}
          <div ref={sentinelRef} aria-hidden="true" className={styles.sentinel} />
        </div>
      )}
    </>
  )
}
