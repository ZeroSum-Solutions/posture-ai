'use client'

/**
 * Dev-only golden Tier B ingest: drop a posture photo, run the REAL detectPose
 * (MediaPipe WASM, same code path as capture), download the landmark JSON for
 * committing under packages/posture-engine/golden/tierb/. Never available in
 * production builds.
 */
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { detectPose } from '@/lib/pose/detect'
import { SCORING_MODEL_VARIANT } from '@/lib/pose/pose-model'
import { TIER_B_PROTOCOL_VERSION } from '@/lib/pose/tierb-contract'

export default function GoldenIngestPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [status, setStatus] = useState('Drop a photo (front or side).')
  const [view, setView] = useState<'front' | 'side'>('front')

  async function onFile(file: File) {
    setStatus(`Detecting ${file.name}…`)
    try {
      // detectPose takes a string URL — create an object URL from the dropped file
      const url = URL.createObjectURL(file)
      const result = await detectPose(url, view, 'upload')
      const payload = {
        frames: [result],
        groundTruth: {}, // fill from photos-local/manifest.csv before committing
        poseModel: SCORING_MODEL_VARIANT,
        protocolVersion: TIER_B_PROTOCOL_VERSION,
        device: navigator.userAgent,
        capturedAt: new Date().toISOString(),
        sourceFile: file.name,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${file.name.replace(/\.[^.]+$/, '')}.landmarks.json`
      a.click()
      setStatus(`Done: ${a.download} downloaded. Next photo?`)
    } catch (e) {
      setStatus(`Detection failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>Golden Tier B ingest (dev only)</h1>
      <label>
        View:{' '}
        <select id="golden-view" name="golden-view" value={view} onChange={e => setView(e.target.value as 'front' | 'side')}>
          <option value="front">front</option>
          <option value="side">side</option>
        </select>
      </label>
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f) }}
        style={{ border: '2px dashed #888', padding: 48, marginTop: 16, textAlign: 'center' }}
      >
        {status}
      </div>
      <input id="golden-file" name="golden-file" type="file" accept="image/*" style={{ marginTop: 12 }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
    </main>
  )
}
