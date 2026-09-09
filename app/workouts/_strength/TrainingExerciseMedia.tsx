'use client'

import { useEffect, useState } from 'react'
import {
  TrainingLaunchMediaBindingV1Schema,
  TrainingLaunchMediaProjectionV1Schema,
  type TrainingLaunchMediaBindingV1,
  type TrainingLaunchMediaProjectionV1,
} from '@/lib/training/media/contract'

type Props = { binding: TrainingLaunchMediaBindingV1; media?: unknown; instruction: string }

/** Validate again at the rendering boundary before exposing any media URL. */
export default function TrainingExerciseMedia({ binding, media, instruction }: Props) {
  const expected = TrainingLaunchMediaBindingV1Schema.safeParse(binding)
  const parsed = TrainingLaunchMediaProjectionV1Schema.safeParse(media)
  const projection = expected.success && parsed.success
    && JSON.stringify(expected.data) === JSON.stringify(parsed.data.binding) ? parsed.data : null
  return <div>
    <p className="t-body">{instruction}</p>
    <Media key={JSON.stringify(projection)} projection={projection} />
  </div>
}

function Media({ projection }: { projection: TrainingLaunchMediaProjectionV1 | null }) {
  const [videoFailed, setVideoFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [now, refreshTime] = useState<number | null>(null)
  const expiry = projection?.status === 'available' && projection.expiresAt
    ? Date.parse(projection.expiresAt) : null
  const expired = projection?.status === 'expired' || (expiry !== null && now !== null && expiry <= now)

  useEffect(() => {
    if (expiry === null) return
    let timer: ReturnType<typeof setTimeout>
    const check = () => {
      clearTimeout(timer)
      refreshTime(Date.now())
      const remaining = expiry - Date.now()
      if (remaining > 0) timer = setTimeout(check, Math.min(remaining, 2_147_483_647))
    }
    check()
    // Recheck when a suspended browser returns as well as when the timer fires.
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [expiry])

  if (!projection || projection.status === 'missing') {
    return <p className="t-quiet" role="status">Exercise media is not available. Follow the written instructions above.</p>
  }
  if (expiry !== null && now === null) {
    return <p className="t-quiet" role="status">Checking exercise media availability. Written instructions remain available.</p>
  }
  if (expired || projection.status !== 'available') {
    return <p className="t-quiet" role="status">Exercise media has expired. Written instructions remain available.</p>
  }
  const video = !videoFailed ? projection.assets.video : undefined
  const poster = !posterFailed ? projection.assets.poster : undefined
  return <figure style={{ margin: 0, minWidth: 0 }}>
    {projection.review.kind === 'synthetic_fixture' ? <p className="t-quiet">Practice media · Simulation</p> : null}
    {video ? <video
      aria-label="Exercise demonstration"
      src={video.path}
      controls playsInline preload="none"
      width={video.width} height={video.height}
      style={{ display: 'block', width: '100%', height: 'auto' }}
      onError={() => setVideoFailed(true)}
    /> : poster ?
      // Native error handling is required for the exact registered asset fallback.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={poster.path} alt={poster.alt} width={poster.width} height={poster.height}
        style={{ display: 'block', width: '100%', height: 'auto' }} onError={() => setPosterFailed(true)} />
      : <p className="t-quiet" role="status">Exercise media could not load. Follow the written instructions above.</p>}
    <figcaption className="t-quiet">
      <a href={projection.source.sourcePageUrl} target="_blank" rel="noopener noreferrer">{projection.source.author}</a>
      {' · '}<a href={projection.source.license.url} target="_blank" rel="noopener noreferrer">{projection.source.license.name}</a>
    </figcaption>
  </figure>
}
