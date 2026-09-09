'use client'
import { BAND_TONE, type SeverityBand } from '@/components/array/severity'
import styles from './AssessmentReview.module.css'

/** Generic region guide. Its outline never encodes a measured body shape. */

export interface ScanMarker {
  /** 1-based, matching the numbered row beneath. */
  number: number
  /** Vertical position down the body, 0 (crown) to 1 (feet). */
  at: number
  band: SeverityBand
  label: string
}

const VIEW = { width: 132, height: 330 } as const
export default function PointScanBody({
  view,
  onViewChange,
  markers,
  caption,
}: {
  view: 'side' | 'front'
  onViewChange: (view: 'side' | 'front') => void
  markers: readonly ScanMarker[]
  caption: string
}) {
  return (
    <div className={styles.scanWrap}>
      <div className={styles.scanHead}>
        <h3 className="t-title">Region guide · {view} view</h3>
        <div className={styles.scanToggle} role="group" aria-label="Body view">
          {(['side', 'front'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={[styles.scanToggleButton, view === option ? styles.scanToggleActive : '']
                .filter(Boolean).join(' ')}
              onClick={() => onViewChange(option)}
            >
              {option === 'side' ? 'Side' : 'Front'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.scanStage}>
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className={styles.scanOverlay}
          aria-hidden="true"
          focusable="false"
        >
          <g fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinejoin="round">
            {view === 'front' ? <>
              <ellipse cx="66" cy="25" rx="13" ry="18" />
              <path d="M59 44 L59 53 L43 60 L27 133 L34 138 L49 84 L51 158 L47 196 L47 310 L60 310 L66 204 L72 310 L85 310 L85 196 L81 158 L83 84 L98 138 L105 133 L89 60 L73 53 L73 44" />
            </> : <>
              <path d="M74 7 C88 8 92 19 91 28 L96 32 L89 35 L85 44 L76 43 L72 54 L80 65 C88 90 85 120 81 147 L77 175 L75 218 L77 306 L91 314 L64 314 L60 215 L57 178 C54 152 61 123 59 101 L65 63 L68 44 C61 33 60 11 74 7 Z" />
              <path d="M73 68 L68 137 L72 172" fill="none" />
            </>}
          </g>
          {/* Fixed visual reference only, not a measured plumb line. */}
          <line
            x1={VIEW.width / 2}
            y1="14"
            x2={VIEW.width / 2}
            y2={VIEW.height - 14}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {markers.map(marker => {
            const y = marker.at * VIEW.height
            return (
              <g key={marker.number}>
                <line
                  x1={VIEW.width * 0.55}
                  y1={y}
                  x2={VIEW.width - 20}
                  y2={y}
                  stroke={BAND_TONE[marker.band]}
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
                <circle cx={VIEW.width - 20} cy={y} r="9" fill={BAND_TONE[marker.band]} />
                <text
                  x={VIEW.width - 20}
                  y={y + 3.5}
                  fill="#000"
                  fontSize="10"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {marker.number}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <p className={styles.scanCaption}>{caption}</p>
    </div>
  )
}
