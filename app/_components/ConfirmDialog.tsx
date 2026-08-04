'use client'
import { useEffect, useId, useRef } from 'react'
import { Surface } from '@/components/array/Surface'

/**
 * Accessible confirmation modal: role="dialog" + aria-modal, labelled by its
 * title, closes on Escape and backdrop click, moves focus in on open and traps
 * Tab within the dialog while it is open.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
  danger = false,
  error,
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  error?: string | null
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    confirmRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  return (
    <div
      onClick={() => { if (!busy) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
    >
      {/* Stops the backdrop's onCancel from firing when the click lands on the panel itself. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420 }}>
        <Surface tier="feature">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 id={titleId} className="t-headline-sm" style={{ marginBottom: 12 }}>{title}</h2>
            <div className="t-body" style={{ marginBottom: 24 }}>{children}</div>
            {error && <p role="alert" className="a-error" style={{ marginBottom: 16 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={onCancel}
                disabled={busy}
                className="a-secondary"
                style={{ flex: 1 }}
              >
                {cancelLabel}
              </button>
              <button
                ref={confirmRef}
                onClick={onConfirm}
                disabled={busy}
                className="a-primary"
                style={{
                  flex: 1,
                  background: danger ? 'var(--review)' : 'var(--action)',
                  color: danger ? '#fff' : 'var(--action-text)',
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </Surface>
      </div>
    </div>
  )
}
