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
      <defs>
        <linearGradient id="posture-mark-flow" x1="12" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF8918" />
          <stop offset="0.44" stopColor="#DA4E24" />
          <stop offset="1" stopColor="#0098F3" />
        </linearGradient>
        <filter id="posture-mark-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="18" fill="#080808" stroke="#FFFFFF" strokeOpacity="0.14" />
      <path d="M17 43C17 25.9 27.1 16 44 16h4" fill="none" stroke="url(#posture-mark-flow)" strokeWidth="9" strokeLinecap="round" />
      <path d="M20 45c0-11.7 7.5-19 19-19h8" fill="none" stroke="#FFFFFF" strokeOpacity="0.13" strokeWidth="2" strokeLinecap="round" />
      <circle cx="47" cy="16" r="5" fill="#FFFFFF" filter="url(#posture-mark-glow)" />
    </svg>
  )
}
