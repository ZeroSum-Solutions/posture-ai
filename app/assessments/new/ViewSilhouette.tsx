import type { CaptureSlotKey } from './types'
import { slotToDomain } from './types'

/** Lightweight silhouette / directional cue per slot (side-right is mirrored). */
export default function ViewSilhouette({ slot, size = 30 }: { slot: CaptureSlotKey; size?: number }) {
  const stroke = 'currentColor'
  const { view } = slotToDomain(slot)
  if (view === 'side') {
    // side-left faces one way; mirror the glyph for side-right.
    const flip = slot === 'side-right' ? { transform: 'scaleX(-1)', transformOrigin: 'center' } : undefined
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={flip}>
        <circle cx="10" cy="5" r="2.4" fill={stroke} />
        <path d="M10 8c2 0 3 1.4 3 3.4 0 2-.6 3-1 4.4l1 4.2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 8c-.6 1.6-.8 3.2-1.4 4.6M8.6 12.6 7 21" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 6.5a5 5 0 0 1 2.6 4.4" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        <path d="m19.6 8.4 0 2.6-2.5-.4" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (view === 'back') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="5" r="2.4" fill={stroke} />
        <path d="M8.4 10c0-1.4 1.4-2.6 3.6-2.6S15.6 8.6 15.6 10l-.7 4h-5.8L8.4 10Z" fill={stroke} />
        <path d="M9.4 14 8.6 21M14.6 14l.8 7" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4.5 4.6a7 7 0 0 1 0 3.4" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
        <path d="m3.2 6.4 1.3 1.8 1.6-1.4" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  // front
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="2.4" fill={stroke} />
      <path d="M8.4 10c0-1.4 1.4-2.6 3.6-2.6S15.6 8.6 15.6 10l-.7 4h-5.8L8.4 10Z" fill={stroke} />
      <path d="M9.4 14 8.6 21M14.6 14l.8 7M8.7 10.4 6.6 13M15.3 10.4 17.4 13" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
