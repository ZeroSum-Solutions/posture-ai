'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import Icon from '@/components/array/Icon'
import { fade, reduced, spring } from '@/lib/motion'
import { Button } from './Button'
import { readOverlayOrigin, trackOverlayOrigins } from './overlayOrigin'
import styles from './Dialog.module.css'

export type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** Rendered as role="alert" above the action buttons, e.g. an async
   *  confirm action (archive, delete) that failed while the dialog stays
   *  open. The dialog keeps its buttons interactive so the caller can retry. */
  error?: ReactNode
  confirm: { label: string; onConfirm: () => void; tone?: 'primary' | 'danger'; busy?: boolean }
  cancel?: { label?: string; onCancel?: () => void }
  className?: string
  'data-testid'?: string
}

type Lean = { x: number; y: number }
type Custom = { reduce: boolean; lean: Lean }

/** How far toward its cause the card starts (a hint of direction, not a flight). */
const LEAN = 0.14

const cardVariants: Variants = {
  hidden: ({ reduce, lean }: Custom) => (reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, x: lean.x, y: lean.y }),
  shown: ({ reduce }: Custom) => ({
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    transition: reduce ? reduced : { ...spring.snap, opacity: { duration: 0.14 } },
  }),
  gone: ({ reduce, lean }: Custom) =>
    reduce
      ? { opacity: 0, transition: reduced }
      : { opacity: 0, scale: 0.96, x: lean.x * 0.5, y: lean.y * 0.5, transition: { ...spring.sheetOut, opacity: { duration: 0.1 } } },
}

/**
 * Centered confirmation card: solid surface-1, radius 28 (DESIGN.md ›
 * Materials — solid for legibility, never glass). It enters on the `snap`
 * spring from .94, leaning in from the control that opened it, over a fading
 * scrim. Confirm sits above Cancel, both full width; a destructive confirm is
 * the coral `danger` button and makes the card an `alertdialog` with a small
 * coral glyph. Initial focus lands on Cancel, the safer control. Escape, the
 * scrim and the back gesture close it; focus is trapped and returned. Only for
 * confirmations and blocking decisions — never for browsing content.
 */
export function Dialog({ open, onOpenChange, title, description, error, confirm, cancel, className, 'data-testid': testId }: DialogProps) {
  // Created once, lazily, during render — see the matching comment in Sheet.tsx.
  const [container] = useState<HTMLDivElement | null>(() => (typeof document === 'undefined' ? null : document.createElement('div')))
  const cancelRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const poppedByHistoryRef = useRef(false)
  const titleId = useId()
  const descId = useId()
  const reduceMotion = useReducedMotion() ?? false
  const [lean, setLean] = useState<Lean>({ x: 0, y: 0 })
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const rect = readOverlayOrigin()
      setLean(
        rect && typeof window !== 'undefined'
          ? {
              x: Math.round((rect.x + rect.width / 2 - window.innerWidth / 2) * LEAN),
              y: Math.round((rect.y + rect.height / 2 - window.innerHeight / 2) * LEAN),
            }
          : { x: 0, y: 0 },
      )
    }
  }

  useEffect(() => {
    trackOverlayOrigins()
    if (!container) return
    document.body.appendChild(container)
    return () => {
      document.body.removeChild(container)
    }
  }, [container])

  function requestClose() {
    if (!poppedByHistoryRef.current && window.history.state?.uiDialog) {
      window.history.back()
    }
    poppedByHistoryRef.current = false
    onOpenChange(false)
  }

  useEffect(() => {
    if (!open || !container) return
    triggerRef.current = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    const siblings = Array.from(document.body.children).filter((el) => el !== container)
    siblings.forEach((el) => el.setAttribute('inert', ''))
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    window.history.pushState({ uiDialog: true }, '')
    const onPopState = () => {
      poppedByHistoryRef.current = true
      onOpenChange(false)
    }
    window.addEventListener('popstate', onPopState)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')
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
  }, [open, container])

  if (!container) return null

  const danger = confirm.tone === 'danger'
  const custom: Custom = { reduce: reduceMotion, lean }

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
            onClick={requestClose}
            aria-hidden="true"
          />
          <div key="dialog" className={styles.center}>
            <motion.div
              ref={dialogRef}
              role={danger ? 'alertdialog' : 'dialog'}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
              className={[styles.dialog, className].filter(Boolean).join(' ')}
              data-tone={danger ? 'danger' : 'primary'}
              data-testid={testId}
              custom={custom}
              variants={cardVariants}
              initial="hidden"
              animate="shown"
              exit="gone"
            >
              {danger ? (
                <span className={styles.glyph} aria-hidden="true">
                  <Icon name="danger-triangle-linear" size={22} />
                </span>
              ) : null}
              <h2 id={titleId} className={styles.title}>{title}</h2>
              {description ? <p id={descId} className={styles.description}>{description}</p> : null}
              {error ? (
                <p role="alert" className={styles.error}>
                  <Icon name="danger-circle-linear" size={16} />
                  <span>{error}</span>
                </p>
              ) : null}
              <div className={styles.actions}>
                <Button
                  variant={danger ? 'danger' : 'primary'}
                  size="lg"
                  block
                  loading={confirm.busy}
                  haptic={danger ? 'warn' : 'tap'}
                  onClick={() => { confirm.onConfirm() }}
                >
                  {confirm.label}
                </Button>
                <Button
                  ref={cancelRef}
                  variant="secondary"
                  size="lg"
                  block
                  haptic={false}
                  onClick={() => { (cancel?.onCancel ?? requestClose)() }}
                >
                  {cancel?.label ?? 'Cancel'}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    container,
  )
}
