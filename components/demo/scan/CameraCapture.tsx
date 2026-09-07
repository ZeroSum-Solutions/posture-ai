'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './ScanExperience.module.css'

export default function CameraCapture({ view, onCapture, onClose }: {
  view: 'front' | 'side'
  onCapture: (image: string) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable in this browser. Use Upload photo instead.')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1440 } }, audio: false })
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return }
        streamRef.current = stream
        if (video.current) {
          video.current.srcObject = stream
          await video.current.play()
        }
      } catch (error) {
        streamRef.current?.getTracks().forEach(track => track.stop())
        streamRef.current = null
        if (!disposed) setError(typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
          ? 'Camera permission was declined. Allow camera access in your browser or use Upload photo.'
          : 'The camera could not start. Close other camera apps, try again, or use Upload photo.')
      }
    }
    void start()
    return () => {
      disposed = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [])

  function capture() {
    const source = video.current
    if (!source?.videoWidth || !source.videoHeight) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(source.videoWidth, source.videoHeight))
    canvas.width = Math.round(source.videoWidth * scale)
    canvas.height = Math.round(source.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) { setError('The camera frame could not be captured. Try Upload photo.'); return }
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.9))
  }

  return (
    <section className={styles.camera} aria-label={`Capture ${view} view`}>
      <h2 className="t-title">{view === 'front' ? 'Face the camera' : 'Turn to a full side profile'}</h2>
      <p className={styles.muted}>Keep your head and feet visible. Stand naturally with your arms relaxed. Ask someone to hold the camera level.</p>
      <video ref={video} className={styles.video} muted playsInline autoPlay onLoadedData={() => setReady(true)} aria-label="Live camera preview" />
      {error ? <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="button" className="a-secondary" onClick={onClose}>Cancel camera</button>
        <button type="button" className="a-primary" onClick={capture} disabled={!ready || Boolean(error)}>Capture {view}</button>
      </div>
    </section>
  )
}
