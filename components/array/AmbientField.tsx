'use client'

import { useEffect, useState } from 'react'
import styles from './AmbientField.module.css'

type SaveDataConnection = { saveData?: boolean; addEventListener?: (type: string, cb: () => void) => void; removeEventListener?: (type: string, cb: () => void) => void }

/**
 * The drift is worth neither the battery nor the data cost when the tab is
 * hidden, the user asked for less motion, or the user asked for less data
 * (`prefers-reduced-data` / the Network Information API's `saveData`).
 */
function useAmbientPaused(): boolean {
  const [paused, setPaused] = useState(true)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reducedData = window.matchMedia('(prefers-reduced-data: reduce)')
    const connection = (navigator as Navigator & { connection?: SaveDataConnection }).connection

    function evaluate() {
      setPaused(
        document.hidden
        || reducedMotion.matches
        || reducedData.matches
        || Boolean(connection?.saveData),
      )
    }

    evaluate()
    document.addEventListener('visibilitychange', evaluate)
    reducedMotion.addEventListener('change', evaluate)
    reducedData.addEventListener('change', evaluate)
    connection?.addEventListener?.('change', evaluate)
    return () => {
      document.removeEventListener('visibilitychange', evaluate)
      reducedMotion.removeEventListener('change', evaluate)
      reducedData.removeEventListener('change', evaluate)
      connection?.removeEventListener?.('change', evaluate)
    }
  }, [])

  return paused
}

/**
 * The aura (DESIGN.md › Colour): the near-black canvas, two large blurred
 * lights (ink-blue top-left, faint volt bottom-right) drifting on one
 * composited layer, and 3% grain. Decorative only, hence `aria-hidden`. Keeps
 * the `app-ambient-field` className the shell's immersive-route CSS hook
 * (`app/globals.css`) targets.
 */
export default function AmbientField() {
  const paused = useAmbientPaused()
  return (
    <div
      className={`${styles.field} app-ambient-field`}
      data-paused={paused ? 'true' : 'false'}
      aria-hidden="true"
    >
      <span className={styles.tint} />
    </div>
  )
}

export type AuraSeverity = 'maintain' | 'monitor' | 'review'

/**
 * Tints the aura toward a severity while mounted (DESIGN.md › Colour: "The
 * aura tints toward the current result's highest severity on Results").
 * Renders an invisible marker; the field picks it up with `:has()`, so it
 * needs no context and costs no re-render. Pass `null` for no tint.
 */
export function AuraTint({ severity }: { severity: AuraSeverity | null | undefined }) {
  if (!severity) return null
  return <span data-aura-tint={severity} hidden />
}
