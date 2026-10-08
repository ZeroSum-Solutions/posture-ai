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
import { contentIn, contentOut, reduced, spring } from '@/lib/motion'
import { trackOverlayOrigins } from './overlayOrigin'
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

/** The capsule the Island grows out of and collapses back into. */
const SEED = 36

type ToastApi = {
  success: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  warn: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

const ToastDispatchContext = createContext<((tone: ToastTone, message: string, options?: ToastOptions) => void) | null>(null)

/** `toast.success(msg, { action, sticky })` / `toast.error(...)` etc. */
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

const lifetime = (t: ToastItem) => (t.sticky ? Infinity : t.action ? 7000 : 4000)

/**
 * Mounts the Island and exposes `useToast()` to everything beneath it.
 * Wrapped once around the tree in `components/AppShell.tsx`.
 *
 * The Island (DESIGN.md › Materials: black glass): one pill at the top centre
 * under the safe area — never near the primary action in the thumb zone. A
 * toast grows out of a 36px capsule into the full message (width/height on
 * the `morph` spring, content crossfading in after the shape moves); a newer
 * toast replaces the current one by morphing to its size; when it expires the
 * Island collapses back into the capsule and fades. Older toasts keep their
 * own timers; if one is still alive when the newest goes, the Island morphs
 * back to it. Hover/focus pauses the visible toast; swipe up dismisses it;
 * sticky toasts carry a Dismiss button.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [paused, setPaused] = useState(false)
  // Starting at null and creating the container in an effect keeps the
  // hydration pass's output identical to the server's (this provider mounts
  // on every page via AppShell, so a lazy initializer would mismatch).
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    trackOverlayOrigins()
    const el = document.createElement('div')
    const host = document.querySelector('.app-shell') ?? document.body
    host.appendChild(el)
    // The one necessary post-hydration setState: there is no portal target
    // until the DOM exists. It fires once, immediately after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContainer(el)
    return () => {
      el.remove()
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const dispatch = useCallback((toastTone: ToastTone, message: string, options?: ToastOptions) => {
    const id = `toast-${(nextId += 1)}`
    setToasts((prev) => [...prev, { id, tone: toastTone, message, ...options }])
  }, [])

  const current = toasts[toasts.length - 1] ?? null

  return (
    <ToastDispatchContext.Provider value={dispatch}>
      {children}
      {toasts.map((t) => (
        <ToastTimer key={t.id} ms={lifetime(t)} paused={paused && t.id === current?.id} onDone={() => dismiss(t.id)} />
      ))}
      {container
        ? createPortal(
            <div className={styles.viewport}>
              <Island item={current} onDismiss={dismiss} onPause={setPaused} />
            </div>,
            container,
          )
        : null}
    </ToastDispatchContext.Provider>
  )
}

/** A per-toast countdown that survives being hidden behind a newer toast. */
function ToastTimer({ ms, paused, onDone }: { ms: number; paused: boolean; onDone: () => void }) {
  const remaining = useRef(ms)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return
    const startedAt = Date.now()
    const timer = setTimeout(() => done.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [paused])
  return null
}

type Size = { w: number; h: number }

function Island({ item, onDismiss, onPause }: { item: ToastItem | null; onDismiss: (id: string) => void; onPause: (paused: boolean) => void }) {
  const reduceMotion = useReducedMotion()
  const [size, setSize] = useState<Size | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  // Measures the current message (a ResizeObserver callback — never a read
  // inside an animation frame); the Island springs to that size.
  const measure = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0]
      const w = Math.ceil(box?.inlineSize ?? node.offsetWidth)
      const h = Math.ceil(box?.blockSize ?? node.offsetHeight)
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  const shape = reduceMotion ? reduced : spring.morph

  return (
    <AnimatePresence onExitComplete={() => setSize(null)}>
      {item ? (
        <motion.div
          key="island"
          className={styles.island}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, width: SEED, height: SEED, y: -6 }}
          animate={{
            opacity: 1,
            y: 0,
            width: size?.w ?? SEED,
            height: size?.h ?? SEED,
            transition: reduceMotion ? reduced : { ...shape, opacity: { duration: 0.12 } },
          }}
          exit={
            reduceMotion
              ? { opacity: 0, transition: reduced }
              : { width: SEED, height: SEED, opacity: 0, y: -4, transition: { ...spring.sheetOut, opacity: { duration: 0.14, delay: 0.16 } } }
          }
          drag={reduceMotion ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.6, bottom: 0.08 }}
          onDragEnd={(_e, info) => {
            if (info.offset.y < -24 || info.velocity.y < -400) onDismiss(item.id)
          }}
          onPointerEnter={() => onPause(true)}
          onPointerLeave={() => onPause(false)}
          onFocus={() => onPause(true)}
          onBlur={() => onPause(false)}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={item.id}
              ref={measure}
              role={item.tone === 'error' ? 'alert' : 'status'}
              aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
              className={styles.content}
              data-tone={item.tone}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: reduceMotion ? reduced : { ...contentIn, delay: 0.1 } }}
              exit={{ opacity: 0, transition: reduceMotion ? reduced : contentOut }}
            >
              <span className={styles.glyph} aria-hidden="true">
                <Icon name={TONE_ICON[item.tone]} size={18} />
              </span>
              <span className={styles.message}>{item.message}</span>
              {item.action ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    item.action?.onPress()
                    onDismiss(item.id)
                  }}
                >
                  {item.action.label}
                </button>
              ) : null}
              {item.sticky ? (
                <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
                  <Icon name="close-linear" size={16} />
                </button>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
