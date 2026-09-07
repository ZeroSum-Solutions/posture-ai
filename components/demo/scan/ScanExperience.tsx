'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PoseFrame } from '@posture-ai/engine'
import { Surface } from '@/components/array/Surface'
import { createDemoScan, createSampleScan, type DemoScan } from '@/lib/demo/scan'
import { clearDemoScan, loadDemoScan, saveDemoScan, subscribeDemoScan } from '@/lib/demo/scan-store'
import { assessFrameQuality } from '@/lib/pose/quality'
import CameraCapture from './CameraCapture'
import ScanResults from './ScanResults'
import ScanVisual from './ScanVisual'
import styles from './ScanExperience.module.css'

type View = 'front' | 'side'
type Capture = { frame: PoseFrame; image: string; warnings: string[] }

export default function ScanExperience() {
  const scan = useSyncExternalStore(subscribeDemoScan, loadDemoScan, () => null)
  const [captures, setCaptures] = useState<Partial<Record<View, Capture>>>({})
  const [camera, setCamera] = useState<View | null>(null)
  const [busy, setBusy] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const operation = useRef(0)
  const busyLock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current += 1 }
  }, [])

  async function detect(view: View, image: string, source: 'camera' | 'upload', run: number) {
    setMessage(`Finding body landmarks in your ${view} view…`)
    const { detectPose } = await import('@/lib/pose/detect')
    const detected = await detectPose(image, view, source)
    if (!mounted.current || run !== operation.current) return
    const quality = assessFrameQuality(detected, view)
    if (detected.detectedPoseCount === 0 || quality.status === 'no_person') throw new Error('No person detected. Use a clear full-body photo with your head and feet visible.')
    if (quality.status === 'multiple_people') throw new Error('More than one person detected. Please use a photo with just you in the frame.')
    // Detector count is transient metadata, not part of the persisted engine frame.
    const frame: PoseFrame = { view, landmarks: detected.landmarks, aspectRatio: detected.aspectRatio, source }
    setCaptures(previous => ({ ...previous, [view]: { frame, image, warnings: quality.warnings } }))
    setMessage(`${view === 'front' ? 'Front' : 'Side'} view ready.`)
  }

  async function processImage(view: View, input: File | string, source: 'camera' | 'upload') {
    if (busyLock.current) return
    busyLock.current = true
    const run = ++operation.current
    setBusy(view)
    setError(null)
    setCamera(null)
    try {
      let image = typeof input === 'string' ? input : ''
      if (typeof input !== 'string') {
        if (!input.type.startsWith('image/')) throw new Error('Choose an image file, such as a JPG, PNG, or WebP.')
        if (input.size > 20 * 1024 * 1024) throw new Error('This photo is too large. Choose an image smaller than 20 MB.')
        setMessage('Preparing your photo…')
        const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
        const normalized = await normalizeUploadedImage(input)
        if (!normalized) throw new Error('This image could not be read. Try a JPG or PNG photo.')
        image = normalized.dataUrl
      }
      if (!mounted.current || run !== operation.current) return
      await detect(view, image, source, run)
    } catch (error) {
      if (mounted.current && run === operation.current) {
        setError(error instanceof Error ? error.message : 'The scan could not complete. Try another photo or the sample scan.')
        setMessage('')
      }
    } finally {
      if (mounted.current && run === operation.current) setBusy(null)
      busyLock.current = false
    }
  }

  function persist(next: DemoScan) {
    try {
      saveDemoScan(next)
      setError(null)
      setMessage('Scan saved in this browser. Your workout can now use these findings.')
    } catch {
      setError('Your browser could not save this scan. Enable browser storage and try again so your workout can use the findings.')
    }
  }

  function analyze() {
    if (!captures.front || !captures.side || busyLock.current) return
    try {
      const next = createDemoScan([captures.front.frame, captures.side.frame])
      if (!next.result.findings.some(finding => finding.reliable)) throw new Error('The body landmarks are not clear enough to score. Retake both views in good light with your full body visible.')
      persist(next)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The scan could not be scored. Retake the photos.')
    }
  }

  function sample() {
    if (busyLock.current) return
    setCaptures({})
    persist(createSampleScan())
  }

  function reset() {
    try { clearDemoScan() } catch { setError('Browser storage could not be cleared. Please allow storage and try again.'); return }
    setCaptures({})
    setMessage('')
    setError(null)
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <p className="t-kicker">01 / Understand your posture</p>
        <h1 className="t-headline">A clearer picture.<br /><em>A better place to start.</em></h1>
        <p className={styles.muted}>Two views. Local AI pose detection. A workout built around what your scan finds.</p>
      </header>
      {error ? <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p> : null}
      <p className={styles.muted} role="status" aria-live="polite">{message}</p>
      {scan ? <ScanResults scan={scan} images={{ front: captures.front?.image, side: captures.side?.image }} onReset={reset} /> : (
        <>
          <Surface tier="feature" innerClassName={styles.stack}>
            <h2 className="t-title">Capture your starting point</h2>
            <p className={styles.muted}>Use the same person, lighting, and camera distance for both photos. Keep your whole body visible, stand naturally, and hold the camera level.</p>
            {camera ? <CameraCapture view={camera} onClose={() => setCamera(null)} onCapture={image => void processImage(camera, image, 'camera')} /> : (
              <div className={styles.views}>
                {(['front', 'side'] as const).map(view => (
                  <div key={view}>
                    {captures[view] ? <ScanVisual frame={captures[view].frame} image={captures[view].image} /> : (
                      <div className={styles.emptyView}>
                        <span aria-hidden="true">{view === 'front' ? '01' : '02'}</span>
                        <h3 className="t-title">{view === 'front' ? 'Front view' : 'Side profile'}</h3>
                        <p className={styles.muted}>{view === 'front' ? 'Face the camera' : 'Turn 90° to the camera'}</p>
                      </div>
                    )}
                    <div className={styles.viewActions}>
                      <button type="button" className="a-secondary" disabled={Boolean(busy)} onClick={() => { setCamera(view); setError(null) }}>{captures[view] ? 'Retake' : 'Camera'} · {view}</button>
                      <label className={`a-secondary ${styles.fileLabel}`}>
                        <span>{busy === view ? 'Detecting…' : 'Upload photo'}</span>
                        <input className={styles.hiddenInput} aria-label={`Upload ${view} photo`} type="file" accept="image/jpeg,image/png,image/webp,image/heic" disabled={Boolean(busy)} onChange={event => {
                          const file = event.currentTarget.files?.[0]
                          event.currentTarget.value = ''
                          if (file) void processImage(view, file, 'upload')
                        }} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(['front', 'side'] as const).map(view => captures[view]?.warnings.length ? <p key={view} className={styles.notice}>{view === 'front' ? 'Front' : 'Side'}: {captures[view].warnings.join(' ')}</p> : null)}
            {!camera ? <button type="button" className="a-primary a-primary--bar" disabled={!captures.front || !captures.side || Boolean(busy)} onClick={analyze}>See my scan findings</button> : null}
            <p className={styles.muted}>Photos are processed on this device and never uploaded. Only landmarks and findings are saved in this browser.</p>
          </Surface>
          <Surface tier="tile" innerClassName={styles.stack}>
            <h2 className="t-title">Try a repeatable sample</h2>
            <p className={styles.muted}>Meet Alex, our synthetic demo subject. The same front and side coordinates run through the real scoring engine every time.</p>
            <button type="button" className="a-secondary" disabled={Boolean(busy) || Boolean(camera)} onClick={sample}>Use sample scan</button>
          </Surface>
        </>
      )}
    </div>
  )
}
