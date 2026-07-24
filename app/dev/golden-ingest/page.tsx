'use client'

/**
 * Dev-only Tier B study surface.
 *
 * The checked-in packet is preparation-only. Collection stays visibly and
 * technically locked until a separately signed collection_authorized packet
 * and governed participant consent exist. Never available in production.
 */
import { notFound } from 'next/navigation'
import { TIER_B_CAPTURE_SLOTS } from '@/lib/pose/tierb-contract'

export default function GoldenIngestPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>Tier B reliability study (dev only)</h1>
      <p role="status" style={{ color: '#9b1c1c', fontWeight: 700 }}>
        Collection not authorized
      </p>
      <p>
        The checked-in study packet is preparation-only. Photo selection,
        processing, and export remain locked until an independently trusted
        collection authorization and participant consent are verified.
      </p>
      <label>
        Planned capture slot:{' '}
        <select id="golden-view" name="golden-view" disabled defaultValue="front">
          {TIER_B_CAPTURE_SLOTS.map(slot => (
            <option
              key={slot.key}
              value={slot.key}
              data-engine-view={slot.engineView}
              data-profile-side={slot.profileSide ?? 'none'}
            >
              {slot.label}
            </option>
          ))}
        </select>
      </label>
      <div
        aria-disabled="true"
        style={{
          border: '2px dashed #888',
          padding: 48,
          marginTop: 16,
          textAlign: 'center',
          opacity: 0.7,
        }}
      >
        Photo processing is locked.
      </div>
      <input
        id="golden-file"
        name="golden-file"
        type="file"
        accept="image/*"
        disabled
        aria-describedby="tier-b-lock-reason"
        style={{ marginTop: 12 }}
      />
      <p id="tier-b-lock-reason">
        No test flag or local bypass unlocks collection.
      </p>
    </main>
  )
}
