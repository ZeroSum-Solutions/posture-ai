'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion'
import { haptic } from '@/lib/haptics'
import { fade, reduced, spring } from '@/lib/motion'
import { IconButton } from './IconButton'
import { useKeyboardInset } from './useKeyboardInset'
import styles from './Sheet.module.css'

export type SheetDetent = 'compact' | 'medium' | 'large'

const DETENT_VH: Record<SheetDetent, number> = { compact: 50, medium: 62, large: 92 }
const DETENT_ORDER: SheetDetent[] = ['compact', 'medium', 'large']

export type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  detents?: SheetDetent[]
  defaultDetent?: SheetDetent
  footer?: ReactNode
  children: ReactNode
  /** Drag-past-150px, scrim tap and Escape all no-op when false; the Close button still closes. */
  dismissible?: boolean
  className?: string
  'data-testid'?: string
}

/**
 * The one bottom sheet, replacing `ExerciseDetailSheet`, `WhyThisSheet` and
 * `MuscleDetailModal` (DESIGN.md › 3.8). Chrome glass panel, a 36×5 grabber,
 * a header with a Title-2 title and an always-present 48px Close, a
 * scrollable body and an optional sticky footer. Detents: `compact` (≤50dvh),
 * `medium` (62dvh), `large` (92dvh) — drag the grabber/header to move between
 * them (haptic `tap` on a successful snap) or past 150px / a fast flick to
 * dismiss. Escape, the scrim and Close all close it; the Android/back
 * gesture does too, via a pushed history entry consumed on any close.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  detents = ['medium'],
  defaultDetent,
  footer,
  children,
  dismissible = true,
  className,
  'data-testid': testId,
}: SheetProps) {
  const order = DETENT_ORDER.filter((d) => detents.includes(d))
  const initialDetent = defaultDetent ?? order[0] ?? 'medium'
  const [detent, setDetent] = useState<SheetDetent>(initialDetent)
  // Resets the detent on every open — without an effect. Adjusting state
  // during render (bailing out before paint) is the React-sanctioned way to
  // reset state in response to a prop change; see "Resetting state ..." in
  // the React docs. An effect-based reset was flagged by
  // react-hooks/set-state-in-effect and runs a frame later besides.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setDetent(initialDetent)
  }
  // The portal target is created once, lazily, during render — never via an
  // effect-body setState — and only mounted/unmounted by the effect below.
  const [container] = useState<HTMLDivElement | null>(() => (typeof document === 'undefined' ? null : document.createElement('div')))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const poppedByHistoryRef = useRef(false)
  const titleId = useId()
  const dragControls = useDragControls()
  const reduceMotion = useReducedMotion()
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (!container) return
    document.body.appendChild(container)
    return () => {
      document.body.removeChild(container)
    }
  }, [container])

  function requestClose() {
    if (!poppedByHistoryRef.current && window.history.state?.uiSheet) {
      window.history.back()
    }
    poppedByHistoryRef.current = false
    onOpenChange(false)
  }

  useEffect(() => {
    if (!open || !container) return
    triggerRef.current = document.activeElement as HTMLElement | null
    titleRef.current?.focus()

    const siblings = Array.from(document.body.children).filter((el) => el !== container)
    siblings.forEach((el) => el.setAttribute('inert', ''))
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    // Android/hardware back closes the sheet instead of leaving the page.
    window.history.pushState({ uiSheet: true }, '')
    const onPopState = () => {
      poppedByHistoryRef.current = true
      onOpenChange(false)
    }
    window.addEventListener('popstate', onPopState)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!dismissible) return
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      siblings.forEach((el) => el.removeAttribute('inert'))
      document.documentElement.style.overflow = previousOverflow
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('keydown', onKeyDown)
      triggerRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container, dismissible])

  function handleDragEnd(_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (dismissible && (info.offset.y > 150 || info.velocity.y > 800)) {
      requestClose()
      return
    }
    const idx = order.indexOf(detent)
    if (info.offset.y > 60 && idx > 0) {
      setDetent(order[idx - 1]!)
      haptic('tap')
    } else if (info.offset.y < -60 && idx < order.length - 1) {
      setDetent(order[idx + 1]!)
      haptic('tap')
    }
  }

  if (!container) return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="scrim"
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            onClick={dismissible ? requestClose : undefined}
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={[styles.panel, className].filter(Boolean).join(' ')}
            data-testid={testId}
            style={{ height: `${DETENT_VH[detent]}dvh`, maxHeight: `calc(100dvh - ${keyboardInset}px)` }}
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: reduceMotion ? reduced : spring.sheet }}
            exit={{ y: '100%', transition: reduceMotion ? reduced : spring.sheetOut }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            <div className={styles.grabberRow} onPointerDown={(e) => dragControls.start(e)}>
              <span className={styles.grabber} />
            </div>
            <div className={styles.header} onPointerDown={(e) => dragControls.start(e)}>
              <h2 id={titleId} ref={titleRef} tabIndex={-1} className={`t-title-2 ${styles.title}`}>{title}</h2>
              <IconButton icon="close-linear" label="Close" onClick={requestClose} haptic={false} />
            </div>
            <div className={styles.body} style={{ overscrollBehavior: 'contain' }}>
              {children}
            </div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    container,
  )
}
