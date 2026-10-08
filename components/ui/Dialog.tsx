'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { fade, reduced, spring } from '@/lib/motion'
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

/**
 * Centered, solid (never glass — it needs maximal legibility), max 340 wide
 * (DESIGN.md › 3.8). Title + description + two stacked full-width buttons:
 * confirm above, cancel below, 12px gap. `role="alertdialog"` for a danger
 * confirm; initial focus lands on Cancel, the safer control. Only for
 * confirmations and blocking decisions — never for browsing content.
 */
export function Dialog({ open, onOpenChange, title, description, error, confirm, cancel, className, 'data-testid': testId }: DialogProps) {
  // Created once, lazily, during render — see the matching comment in Sheet.tsx.
  const [container] = useState<HTMLDivElement | null>(() => (typeof document === 'undefined' ? null : document.createElement('div')))
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const poppedByHistoryRef = useRef(false)
  const titleId = useId()
  const descId = useId()
  const reduceMotion = useReducedMotion()

  useEffect(() => {
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
            onClick={requestClose}
            aria-hidden="true"
          />
          <motion.div
            key="dialog"
            className={styles.center}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          >
            <motion.div
              ref={dialogRef}
              role={danger ? 'alertdialog' : 'dialog'}
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
              className={[styles.dialog, className].filter(Boolean).join(' ')}
              data-testid={testId}
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: reduceMotion ? reduced : spring.sheet }}
              exit={{ scale: 0.97, opacity: 0, transition: reduceMotion ? reduced : spring.sheetOut }}
            >
              <h2 id={titleId} className="t-title-2">{title}</h2>
              {description ? <p id={descId} className="t-body" style={{ color: 'var(--text-2)', marginTop: 'var(--s-8)' }}>{description}</p> : null}
              {error ? <p role="alert" className="t-footnote" style={{ color: 'var(--review)', marginTop: 'var(--s-8)' }}>{error}</p> : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => { confirm.onConfirm() }}
                  disabled={confirm.busy}
                  aria-busy={confirm.busy}
                  className={danger ? 'a-secondary' : 'a-primary'}
                  style={danger ? { color: 'var(--review)' } : undefined}
                >
                  {confirm.label}
                </button>
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => { (cancel?.onCancel ?? requestClose)() }}
                  className="a-secondary"
                >
                  {cancel?.label ?? 'Cancel'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    container,
  )
}
