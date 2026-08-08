type IconProps = { size?: number; className?: string }

export function AnatomyGlyph({ size = 44, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      {/* currentColor throughout — no baked-in hue; a caller may layer a severity token per joint, never the glyph itself */}
      <circle cx="24" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M24 12v11m-9-5 9-4 9 4M18 19l-3 11m15-11 3 11M24 23l-7 10m7-10 7 10M17 33l-1 9m15-9 1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="23" r="3.5" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="17" cy="33" r="2.6" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="31" cy="33" r="2.6" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function CameraGlyph({ size = 32, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="8" width="25" height="18.5" rx="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m10 8 2.2-3h7.6L22 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="17" r="5" stroke="currentColor" strokeWidth="2" />
      <circle cx="24.2" cy="11.8" r="1.2" fill="currentColor" />
    </svg>
  )
}

export function CheckGlyph({ size = 32, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="12" stroke="var(--maintain)" strokeWidth="1.5" />
      <path d="m10.5 16.2 3.5 3.5 7.8-8.1" stroke="var(--maintain)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AudioGlyph({ size = 20, className, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 9.5v5h3.4l4.6 3.8V5.7L7.4 9.5H4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {muted ? (
        <path d="m16 9 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      ) : (
        <>
          <path d="M15.3 9.1a4.2 4.2 0 0 1 0 5.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M18 6.6a7.6 7.6 0 0 1 0 10.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
