import type { CSSProperties } from 'react'

export default function BrandMark({ size = 28, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
    >
      <rect x="1" y="1" width="62" height="62" rx="18" fill="#080808" stroke="#FFFFFF" strokeOpacity="0.14" />
      {/* Flat white-alpha stroke, not a hue gradient — colour is reserved for clinical severity */}
      <path d="M17 43C17 25.9 27.1 16 44 16h4" fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth="9" strokeLinecap="round" />
      <path d="M20 45c0-11.7 7.5-19 19-19h8" fill="none" stroke="#FFFFFF" strokeOpacity="0.13" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
