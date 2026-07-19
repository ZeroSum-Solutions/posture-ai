'use client'

import { useEffect, useState } from 'react'
import {
  disableLiveTelemetry,
  enableLiveTelemetry,
  getLiveTelemetrySnapshot,
  isLiveTelemetryEnabled,
  recordLiveTelemetry,
  shouldEnableCaptureTelemetry,
  subscribeLiveTelemetry,
  updateLiveTelemetryDevice,
  type LiveTelemetryDevice,
  type LiveTelemetrySnapshot,
} from '@/lib/pose/live-telemetry'
import type { CaptureSlotKey } from './types'

interface CaptureTelemetryPanelProps {
  activeSlot: CaptureSlotKey
  phase: string
}

export default function CaptureTelemetryPanel(props: CaptureTelemetryPanelProps) {
  if (process.env.NODE_ENV === 'production') return null
  return <DevelopmentPanel {...props} />
}

function DevelopmentPanel({ activeSlot, phase }: CaptureTelemetryPanelProps) {
  const [snapshot, setSnapshot] = useState<LiveTelemetrySnapshot | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (!shouldEnableCaptureTelemetry(process.env.NODE_ENV, window.location.search)) return
    enableLiveTelemetry(readDevice())

    const heapMemory = readHeapBytes() !== null
    const observer = observeLongTasks()
    const longTaskObserver = observer !== null
    recordLiveTelemetry({ type: 'capabilities', heapMemory, longTaskObserver })
    sampleMemory()

    let refreshTimer: number | null = null
    const refresh = () => {
      if (refreshTimer !== null) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        setSnapshot(getLiveTelemetrySnapshot())
        setCopyState('idle')
      }, 500)
    }
    const unsubscribe = subscribeLiveTelemetry(refresh)
    const memoryTimer = window.setInterval(sampleMemory, 2000)
    const updateDevice = () => updateLiveTelemetryDevice(readDevice())
    window.addEventListener('resize', updateDevice)
    refresh()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      window.clearInterval(memoryTimer)
      window.removeEventListener('resize', updateDevice)
      observer?.disconnect()
      unsubscribe()
      disableLiveTelemetry()
    }
  }, [])

  useEffect(() => {
    if (isLiveTelemetryEnabled()) recordLiveTelemetry({ type: 'view', view: activeSlot, phase })
  }, [activeSlot, phase])

  if (!snapshot) return null

  const copyJson = async () => {
    const current = getLiveTelemetrySnapshot()
    if (!current) return
    try {
      await copyText(JSON.stringify(current, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <details
      data-testid="capture-telemetry"
      style={{ position: 'fixed', top: 'max(64px, env(safe-area-inset-top, 0px))', right: 12, zIndex: 220, width: 'min(300px, calc(100vw - 24px))', maxHeight: '70vh', overflow: 'auto', padding: '8px 10px', borderRadius: 10, background: 'rgba(8,8,10,0.94)', border: '1px solid rgba(255,255,255,0.22)', color: '#F4F4F5', fontSize: 12 }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Live telemetry · dev only</summary>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px', fontVariantNumeric: 'tabular-nums' }}>
        <Metric label="Worker init p95" value={formatMs(snapshot.worker.initP95Ms)} />
        <Metric label="Inference p95" value={formatMs(snapshot.inference.p95Ms)} />
        <Metric label="Round trip p95" value={formatMs(snapshot.roundTrip.p95Ms)} />
        <Metric label="Frames result/drop" value={`${snapshot.frames.results}/${snapshot.frames.dropped}`} />
        <Metric label="Late results sampled" value={String(snapshot.frames.lateResults)} />
        <Metric label="Late worker ready" value={String(snapshot.worker.lateReadyCount)} />
        <Metric label="Long tasks" value={snapshot.capabilities.longTaskObserver ? String(snapshot.longTasks.count) : 'unsupported'} />
        <Metric label="Peak JS heap" value={snapshot.capabilities.heapMemory ? formatBytes(snapshot.memory.peakBytes) : 'unsupported'} />
        <Metric label="Worker errors" value={String(snapshot.worker.errors)} />
        <Metric label="Delegate(s)" value={snapshot.worker.delegates.join(', ') || 'pending'} />
        <Metric label="Samples truncated" value={snapshot.sampling.truncated ? 'yes' : 'no'} />
      </div>
      <p style={{ margin: '8px 0', color: '#A1A1AA', lineHeight: 1.4 }}>
        Export contains device and timing data only—no photos, landmarks, or client fields.
      </p>
      <button
        type="button"
        onClick={() => void copyJson()}
        style={{ width: '100%', minHeight: 40, borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#F4F4F5', fontWeight: 700, cursor: 'pointer' }}
      >
        {copyState === 'copied' ? 'Copied JSON' : copyState === 'failed' ? 'Copy failed' : 'Copy telemetry JSON'}
      </button>
    </details>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <><span style={{ color: '#A1A1AA' }}>{label}</span><span>{value}</span></>
}

function readDevice(): LiveTelemetryDevice {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    userAgent: nav.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    hardwareConcurrency: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
  }
}

function observeLongTasks(): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined') return null
  if (!(PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false)) return null
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recordLiveTelemetry({ type: 'long-task', durationMs: entry.duration })
    })
    observer.observe({ entryTypes: ['longtask'] })
    return observer
  } catch {
    return null
  }
}

function sampleMemory(): void {
  const usedBytes = readHeapBytes()
  if (usedBytes !== null) recordLiveTelemetry({ type: 'memory', usedBytes })
}

function readHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('copy failed')
}

function formatMs(value: number | null): string {
  return value === null ? 'pending' : `${value.toFixed(1)} ms`
}

function formatBytes(value: number | null): string {
  return value === null ? 'pending' : `${(value / (1024 * 1024)).toFixed(1)} MB`
}
