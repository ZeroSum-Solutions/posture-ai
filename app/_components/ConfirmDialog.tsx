'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui/Dialog'

/**
 * Thin adapter over the shared `Dialog` primitive (spec §3.8) that keeps this
 * component's original props so existing callers (e.g.
 * app/clients/[id]/ClientDetailClient.tsx) don't change. Callers mount this
 * conditionally (`{showConfirm && <ConfirmDialog .../>}`) rather than passing
 * an `open` boolean, so it is always "open" for as long as it is mounted.
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
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  danger?: boolean
  error?: string | null
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={title}
      description={
        <>
          {children}
          {error ? (
            <p role="alert" className="a-error" style={{ marginTop: 'var(--s-12)' }}>
              {error}
            </p>
          ) : null}
        </>
      }
      confirm={{ label: confirmLabel, onConfirm, tone: danger ? 'danger' : 'primary', busy }}
      cancel={{ label: cancelLabel, onCancel }}
    />
  )
}
