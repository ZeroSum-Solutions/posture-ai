'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Icon from '@/components/array/Icon'
import styles from './TopBar.module.css'

export interface TopBarProps {
  title: string
  subtitle?: string
  back?: { href: string; label: string }
  actions?: ReactNode
  /** @default true */
  large?: boolean
  /**
   * `media`: the bar sits over a photo/video/3D frame — the back control
   * becomes a 44px glass circle so it reads on any image. Default `canvas`.
   */
  variant?: 'canvas' | 'media'
}

/** Mirrors --topbar-h: the large title counts as "gone" once it slides under the bar. */
const BAR_H = 52

/**
 * Array v4 top bar (DESIGN.md › Navigation): transparent at rest, the large
 * title living in the content as the page's `<h1>`. Once the title scrolls
 * under the bar (an IntersectionObserver on a sentinel — no scroll handler,
 * no layout reads), a compact liquid-glass bar fades and slides in behind the
 * row and its small title rises into place. Back and actions stay in one bar
 * row at all times; nothing is rendered twice. With `large={false}` the
 * compact title is the `<h1>` and the glass is always on. On browsers with
 * scroll-driven animations the large title also eases back and fades as it
 * leaves (compositor-only, off under reduced motion).
 */
export default function TopBar({ title, subtitle, back, actions, large = true, variant = 'canvas' }: TopBarProps) {
  const [collapsed, setCollapsed] = useState(!large)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // With no back and no actions the empty row overlays the content instead
  // of pushing the large title down.
  const emptyBar = !back && !actions

  useEffect(() => {
    if (!large) return
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    // An overlaid bar starts on top of the large title, so a title with no
    // subtitle would sit inside the bar band at rest and load collapsed.
    // There, collapse once the title has left the viewport instead.
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0, rootMargin: emptyBar ? '0px' : `-${BAR_H}px 0px 0px 0px` },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [large, emptyBar])

  return (
    <>
      <div
        className={[styles.bar, large && emptyBar ? styles.overlay : ''].filter(Boolean).join(' ')}
        data-collapsed={collapsed ? 'true' : 'false'}
        data-variant={variant}
      >
        <span className={styles.glass} aria-hidden="true" />
        <div className={styles.row}>
          {back ? (
            <Link href={back.href} aria-label={back.label} className={styles.backButton}>
              <span className={styles.backVisual}>
                <Icon name="alt-arrow-left-linear" size={22} />
              </span>
            </Link>
          ) : null}
          {large ? (
            <span className={styles.compactTitle} aria-hidden="true">
              {title}
            </span>
          ) : (
            <h1 className={styles.compactTitle}>{title}</h1>
          )}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </div>

      {large && (
        <div className={styles.largeWrap}>
          <h1 className={styles.largeTitle}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          <div ref={sentinelRef} aria-hidden="true" className={styles.sentinel} />
        </div>
      )}
    </>
  )
}
