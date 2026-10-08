'use client'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo, type Variants } from 'framer-motion'
import { haptic } from '@/lib/haptics'
import { contentIn, contentOut, fade, reduced, spring } from '@/lib/motion'
import { IconButton } from './IconButton'
import { readOverlayOrigin, trackOverlayOrigins, type OriginRect, type OverlayOrigin } from './overlayOrigin'
import { useKeyboardInset } from './useKeyboardInset'
import styles from './Sheet.module.css'

/** Open sheets, innermost last: only the top sheet answers Escape, Tab and back. */
const openSheets: string[] = []
const isTopSheet = (id: string) => openSheets[openSheets.length - 1] === id

export type SheetDetent = 'compact' | 'medium' | 'large'

const DETENT_VH: Record<SheetDetent, number> = { compact: 50, medium: 62, large: 92 }
const DETENT_ORDER: SheetDetent[] = ['compact', 'medium', 'large']

/** Mirrors --content-max and --r-lg; only used to compute the origin morph. */
const PANEL_MAX_W = 480
const PANEL_RADIUS = 28

/**
 * The resting clip: the panel's box, extended one viewport below it so the
 * `::after` skirt (Sheet.module.css) shows when the panel lifts — over-drag
 * upward, or a detent shrinking — instead of a gap under the sheet.
 */
const fullClip = (vh: number) => `inset(0px 0px -${Math.round(vh)}px 0px round ${PANEL_RADIUS}px ${PANEL_RADIUS}px 0px 0px)`

/** A detent's height in px (the same sum the CSS height/max-height make). */
function detentPx(detent: SheetDetent, keyboardInset: number): number {
  const vh = window.innerHeight
  return Math.min((DETENT_VH[detent] / 100) * vh, vh - keyboardInset)
}

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
  /**
   * Where the sheet grows from ("morph from cause"). Defaults to the control
   * the user just pressed (or the focused one); pass a rect or element to
   * choose, or `'none'` to always rise from the bottom edge.
   */
  origin?: OverlayOrigin | 'none'
  className?: string
  'data-testid'?: string
}

type MorphFrom = { y: number; clip: string }
type Custom = { reduce: boolean; from: MorphFrom | null; dragged: boolean; full: string }

/**
 * Turns the trigger's rect into the panel's starting pose: a clip-path inset
 * that exactly covers the trigger (with its own corner radius) plus, when the
 * trigger sits above the panel's resting top edge, a lift so the clip can
 * reach it. Clip-path keeps the content unsquashed — the shape morphs, the
 * content crossfades in after it (DESIGN.md › Motion rule 1).
 */
function morphFrom(rect: OriginRect | null, detent: SheetDetent, keyboardInset: number): MorphFrom | null {
  if (!rect || typeof window === 'undefined') return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pw = Math.min(PANEL_MAX_W, vw)
  const ph = Math.min((DETENT_VH[detent] / 100) * vh, vh - keyboardInset)
  const left = (vw - pw) / 2
  const top = vh - ph
  const dy = rect.y < top ? rect.y - top : 0
  const clamp = (n: number) => Math.max(0, Math.round(n))
  const t = clamp(rect.y - (top + dy))
  const l = clamp(rect.x - left)
  const r = clamp(left + pw - (rect.x + rect.width))
  const b = clamp(vh + dy - (rect.y + rect.height))
  if (t + b >= ph || l + r >= pw) return null
  const radius = Math.round(Math.min(rect.height / 2, rect.width / 2, PANEL_RADIUS))
  return { y: Math.round(dy), clip: `inset(${t}px ${r}px ${b}px ${l}px round ${radius}px ${radius}px ${radius}px ${radius}px)` }
}

const panelVariants: Variants = {
  hidden: ({ reduce, from, full }: Custom) =>
    reduce ? { opacity: 0, y: 0, clipPath: full } : from ? { opacity: 0, y: from.y, clipPath: from.clip } : { opacity: 1, y: '100%', clipPath: full },
  shown: ({ reduce, from, full }: Custom) => ({
    opacity: 1,
    y: 0,
    clipPath: full,
    transition: reduce ? reduced : from ? { ...spring.morph, opacity: { duration: 0.1 } } : spring.glide,
  }),
  gone: ({ reduce, from, dragged }: Custom) =>
    reduce
      ? { opacity: 0, transition: reduced }
      : from && !dragged
        ? { y: from.y, clipPath: from.clip, opacity: 0, transition: { ...spring.sheetOut, opacity: { duration: 0.12, delay: 0.14 } } }
        : { y: '100%', transition: spring.sheetOut },
}

const contentVariants: Variants = {
  hidden: ({ reduce, from }: Custom) => ({ opacity: from && !reduce ? 0 : 1 }),
  shown: ({ reduce, from }: Custom) => ({ opacity: 1, transition: from && !reduce ? { ...contentIn, delay: 0.12 } : { duration: 0 } }),
  gone: ({ reduce, from, dragged }: Custom) => ({ opacity: from && !reduce && !dragged ? 0 : 1, transition: contentOut }),
}

/**
 * The one bottom sheet (DESIGN.md › Materials: solid surface-1, radius 28 on
 * top). It grows out of the control that opened it — a clip-path morph from
 * that control's rect, the content crossfading in once the shape has moved —
 * or rises on `glide` when there is no origin. A grab handle and the header
 * drag it: the finger is followed 1:1 downward, upward over-drag
 * rubber-bands (×0.3), and release hands its velocity to the settle spring.
 * Past 150px or a fast flick dismisses; ±60px moves between detents
 * (`compact` 50dvh, `medium` 62dvh, `large` 92dvh). Escape, the scrim, Close
 * and the Android/browser back gesture (a pushed history entry) all close it;
 * only the top sheet of a stack answers. Focus is trapped and returned.
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
  origin,
  className,
  'data-testid': testId,
}: SheetProps) {
  const order = DETENT_ORDER.filter((d) => detents.includes(d))
  const initialDetent = defaultDetent ?? order[0] ?? 'medium'
  const [detent, setDetent] = useState<SheetDetent>(initialDetent)
  const keyboardInset = useKeyboardInset()
  const [from, setFrom] = useState<MorphFrom | null>(null)
  const [dragged, setDragged] = useState(false)
  // Resets per-open state without an effect: adjusting state during render
  // (bailing out before paint) is the React-sanctioned way to respond to a
  // prop change. The origin rect is read once here, at the open edge.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setDetent(initialDetent)
      setDragged(false)
      setFrom(morphFrom(readOverlayOrigin(origin), initialDetent, keyboardInset))
    }
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
  const reduceMotion = useReducedMotion() ?? false
  // The panel's y. Variants and drag both drive it; a detent change also
  // offsets it so the top edge glides to the new height instead of jumping.
  const y = useMotionValue(0)
  const detentMorphRef = useRef<{ offset: number; velocity: number } | null>(null)

  useLayoutEffect(() => {
    const morph = detentMorphRef.current
    if (!morph) return
    detentMorphRef.current = null
    // Same frame as the new height: hold the top edge where it was, then let
    // it settle with the finger's velocity.
    y.set(morph.offset)
    animate(y, 0, reduceMotion ? reduced : { ...spring.settle, velocity: morph.velocity })
  }, [detent, y, reduceMotion])

  useEffect(() => {
    trackOverlayOrigins()
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

    openSheets.push(titleId)
    // Only mark what isn't inert yet, so closing a nested sheet doesn't wake the
    // page underneath its parent sheet.
    const siblings = Array.from(document.body.children).filter((el) => el !== container && !el.hasAttribute('inert'))
    siblings.forEach((el) => el.setAttribute('inert', ''))
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    // Android/hardware back closes the sheet instead of leaving the page.
    window.history.pushState({ uiSheet: true }, '')
    const onPopState = () => {
      if (!isTopSheet(titleId)) return
      poppedByHistoryRef.current = true
      onOpenChange(false)
    }
    window.addEventListener('popstate', onPopState)

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTopSheet(titleId)) return
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
      const at = openSheets.lastIndexOf(titleId)
      if (at !== -1) openSheets.splice(at, 1)
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
      // The exit spring starts from the finger's position and velocity.
      setDragged(true)
      requestClose()
      return
    }
    const idx = order.indexOf(detent)
    const next = info.offset.y > 60 && idx > 0 ? order[idx - 1]! : info.offset.y < -60 && idx < order.length - 1 ? order[idx + 1]! : null
    if (!next) return
    detentMorphRef.current = {
      offset: y.get() + detentPx(next, keyboardInset) - detentPx(detent, keyboardInset),
      velocity: info.velocity.y,
    }
    setDetent(next)
    haptic('tap')
  }

  if (!container) return null

  const custom: Custom = { reduce: reduceMotion, from, dragged, full: fullClip(window.innerHeight) }
  const startDrag = (e: React.PointerEvent) => dragControls.start(e)

  return createPortal(
    <AnimatePresence custom={custom}>
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
            data-detent={detent}
            style={{ height: `${DETENT_VH[detent]}dvh`, maxHeight: `calc(100dvh - ${keyboardInset}px)`, y }}
            custom={custom}
            variants={panelVariants}
            initial="hidden"
            animate="shown"
            exit="gone"
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.3, bottom: 1 }}
            dragTransition={{ bounceStiffness: spring.settle.stiffness, bounceDamping: spring.settle.damping }}
            onDragEnd={handleDragEnd}
          >
            <motion.div className={styles.content} custom={custom} variants={contentVariants}>
              <div className={styles.grabberRow} onPointerDown={startDrag} aria-hidden="true">
                <span className={styles.grabber} />
              </div>
              <div className={styles.header} onPointerDown={startDrag}>
                <h2 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title}>{title}</h2>
                <IconButton icon="close-linear" label="Close" onClick={requestClose} haptic={false} className={styles.close} />
              </div>
              <div className={styles.body}>{children}</div>
              {footer ? <div className={styles.footer}>{footer}</div> : null}
            </motion.div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    container,
  )
}
