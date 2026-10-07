'use client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { tone as severityTone } from '@/components/array/severity'
import { reduced, spring } from '@/lib/motion'
import { useKeyboardInset } from './useKeyboardInset'
import styles from './Toast.module.css'

export type ToastTone = 'success' | 'info' | 'warn' | 'error'
export type ToastOptions = { action?: { label: string; onPress: () => void }; sticky?: boolean }
type ToastItem = { id: string; tone: ToastTone; message: string } & ToastOptions

const TONE_ICON: Record<ToastTone, IconName> = {
  success: 'check-circle-linear',
  info: 'info-circle-linear',
  warn: 'danger-triangle-linear',
  error: 'danger-circle-linear',
}
const TONE_BAND: Record<ToastTone, 'maintain' | 'info' | 'monitor' | 'review'> = {
  success: 'maintain',
  info: 'info',
  warn: 'monitor',
  error: 'review',
}

type ToastApi = {
  success: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  warn: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

const ToastDispatchContext = createContext<((tone: ToastTone, message: string, options?: ToastOptions) => void) | null>(null)

/** `toast.success(msg, { action, sticky })` / `toast.error(...)` etc. (DESIGN.md › 3.9). */
export function useToast(): ToastApi {
  const dispatch = useContext(ToastDispatchContext)
  if (!dispatch) throw new Error('useToast must be used within a ToastProvider')
  return useMemo(
    () => ({
      success: (message: string, options?: ToastOptions) => dispatch('success', message, options),
      info: (message: string, options?: ToastOptions) => dispatch('info', message, options),
      warn: (message: string, options?: ToastOptions) => dispatch('warn', message, options),
      error: (message: string, options?: ToastOptions) => dispatch('error', message, options),
    }),
    [dispatch],
  )
}

let nextId = 0

/**
 * Mounts the toast viewport and exposes `useToast()` to everything beneath
 * it. Not mounted by this PR — the shell agent owns `AppShell` and should
 * wrap it there once; see the handoff note in the final report.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Created once, lazily, during render — see the matching comment in Sheet.tsx.
  const [container] = useState<HTMLDivElement | null>(() => (typeof document === 'undefined' ? null : document.createElement('div')))
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (!container) return
    // Mount inside the shell so the toast reads the shell's live
    // --chrome-bottom (tab bar + ActionBar) and never covers the ActionBar.
    const host = document.querySelector('.app-shell') ?? document.body
    host.appendChild(container)
    return () => {
      container.remove()
    }
  }, [container])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dispatch = useCallback((toastTone: ToastTone, message: string, options?: ToastOptions) => {
    const id = `toast-${(nextId += 1)}`
    setToasts((prev) => [...prev, { id, tone: toastTone, message, ...options }])
  }, [])

  return (
    <ToastDispatchContext.Provider value={dispatch}>
      {children}
      {container
        ? createPortal(
            <div className={styles.viewport} style={{ '--keyboard-inset': `${keyboardInset}px` } as React.CSSProperties}>
              {/* Only the 2 most recent are visible at once (DESIGN.md › 3.9); older ones still clear on their own timers. */}
              <AnimatePresence>
                {toasts.slice(-2).map((t) => (
                  <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
                ))}
              </AnimatePresence>
            </div>,
            container,
          )
        : null}
    </ToastDispatchContext.Provider>
  )
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { tone: toastTone, message, action, sticky } = item
  const reduceMotion = useReducedMotion()
  const pausedRef = useRef(false)
  const remainingRef = useRef(sticky ? Infinity : action ? 7000 : 4000)
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const start = useCallback(() => {
    if (!Number.isFinite(remainingRef.current) || pausedRef.current) return
    clear()
    startedAtRef.current = Date.now()
    timerRef.current = setTimeout(onDismiss, remainingRef.current)
  }, [clear, onDismiss])

  const pause = useCallback(() => {
    pausedRef.current = true
    if (timerRef.current) {
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
    }
    clear()
  }, [clear])

  const resume = useCallback(() => {
    pausedRef.current = false
    start()
  }, [start])

  useEffect(() => {
    start()
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const band = TONE_BAND[toastTone]
  const color = severityTone(band)

  return (
    <motion.div
      role={toastTone === 'error' ? 'alert' : 'status'}
      aria-live={toastTone === 'error' ? 'assertive' : 'polite'}
      className={styles.toast}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: reduceMotion ? reduced : spring.state }}
      exit={{ opacity: 0, y: 8, transition: reduceMotion ? reduced : spring.state }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_e, info) => {
        if (info.offset.y > 40) onDismiss()
      }}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className={styles.icon} style={{ color }}>
        <Icon name={TONE_ICON[toastTone]} size={18} />
      </span>
      <span className="t-callout" style={{ color: 'var(--text-1)' }}>{message}</span>
      {action ? (
        <button type="button" className={`a-quiet ${styles.action}`} onClick={() => { action.onPress(); onDismiss() }}>
          {action.label}
        </button>
      ) : null}
    </motion.div>
  )
}
