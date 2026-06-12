'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rollPitchFromOrientation } from './orientation-math'

/** 'pending' removed — initial state is now computed synchronously via lazy useState. */
export type LevelPermission = 'needs-request' | 'granted' | 'denied' | 'unsupported'

export interface CameraLevel {
  permission: LevelPermission
  /** Throttled camera roll (deg); null when sensors/permission unavailable or not in portrait. */
  rollDeg: number | null
  pitchDeg: number | null
  /** Always-current roll for reading at the capture instant. */
  rollRef: React.RefObject<number | null> // React 19 RefObject is mutable; the hook updates this on every sensor event.
  /** Must be invoked from a user gesture (iOS requirement). */
  requestAccess: () => Promise<void>
}

interface DOEWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const UPDATE_INTERVAL_MS = 100   // ~10 Hz UI updates; raw events fire faster
const NO_EVENT_TIMEOUT_MS = 1500 // desktops expose the API but never fire

function inPortrait(): boolean {
  if (typeof screen === 'undefined' || !screen.orientation) return true
  return screen.orientation.type.startsWith('portrait')
}

function initialPermission(): LevelPermission {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return 'unsupported'
  const doe = window.DeviceOrientationEvent as unknown as DOEWithPermission
  return typeof doe.requestPermission === 'function' ? 'needs-request' : 'granted'
}

export function useCameraLevel(): CameraLevel {
  const [permission, setPermission] = useState<LevelPermission>(initialPermission)
  const [rollDeg, setRollDeg] = useState<number | null>(null)
  const [pitchDeg, setPitchDeg] = useState<number | null>(null)
  const rollRef = useRef<number | null>(null)
  // -Infinity so the FIRST event always passes the throttle (also under fake
  // timers in tests, where Date.now() starts at 0).
  const lastUpdateRef = useRef(-Infinity)
  const listeningRef = useRef(false)

  const handleEvent = useCallback((e: DeviceOrientationEvent) => {
    if (e.beta === null || e.beta === undefined || e.gamma === null || e.gamma === undefined) return
    if (!inPortrait()) {
      // Roll/gamma mapping is only validated for portrait — suspend the gate.
      rollRef.current = null
      setRollDeg(null)
      setPitchDeg(null)
      return
    }
    const { rollDeg: r, pitchDeg: p } = rollPitchFromOrientation(e.beta, e.gamma)
    rollRef.current = r
    const now = Date.now()
    if (now - lastUpdateRef.current >= UPDATE_INTERVAL_MS) {
      lastUpdateRef.current = now
      setRollDeg(r)
      setPitchDeg(p)
    }
  }, [])

  const startListening = useCallback(() => {
    if (listeningRef.current) return
    listeningRef.current = true
    window.addEventListener('deviceorientation', handleEvent as EventListener)
  }, [handleEvent])

  useEffect(() => {
    if (permission !== 'granted') return
    startListening()
    const timer = setTimeout(() => {
      // API present but silent (desktop): degrade so the UI doesn't wait forever.
      if (rollRef.current === null) {
        setPermission(p => (p === 'granted' ? 'unsupported' : p))
      }
    }, NO_EVENT_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
      if (listeningRef.current) {
        window.removeEventListener('deviceorientation', handleEvent as EventListener)
        listeningRef.current = false
      }
    }
  }, [permission, handleEvent, startListening])

  const requestAccess = useCallback(async () => {
    const doe = window.DeviceOrientationEvent as unknown as DOEWithPermission
    if (typeof doe.requestPermission !== 'function') return
    try {
      const result = await doe.requestPermission()
      if (result === 'granted') {
        setPermission('granted')
      } else {
        setPermission('denied')
      }
    } catch {
      setPermission('denied')
    }
  }, [])

  return { permission, rollDeg, pitchDeg, rollRef, requestAccess }
}
