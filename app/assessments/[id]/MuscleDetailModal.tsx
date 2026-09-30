'use client'
/**
 * Muscle detail pop-up over the results page — opened from the posture map's Details button, so
 * the practitioner never leaves the page. A centered dialog: fixed header, scrolling body; close
 * with ✕, Escape or a tap outside. Shows what THIS scan found on each
 * side and why (link rationale per finding), the program steps that work the muscle (stretch
 * when tight, strengthen when weak), and the authored anatomy/function copy. Content comes from
 * the practitioner-gated /api/clinical-content/muscles/[slug] route.
 */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Surface } from '@/components/array/Surface'
import { Chip } from '@/components/array/Chip'
import type { ClinicalProgramReport } from '@/lib/program/clinicalProjection'
import ExerciseDetailSheet from './ExerciseDetailSheet'
import { useFocusTrap } from './useFocusTrap'
import {
  STATE_COLORS,
  prescribedSteps,
  prettySlug,
  severityWord,
  sidesBySlug,
  sidesSummary,
  type BodySide,
  type ExerciseRole,
  type SideState,
} from './anatomyFocus'
import { findingsToMuscleStates, type AssessmentFinding } from './findingsToMuscleStates'
import styles from './MuscleDetailModal.module.css'

type Detail = {
  muscle: { slug: string; name: string; region: string; anatomy: string; function: string; screening_notes: string }
  links: Array<{ imbalance_key: string; role: 'tight' | 'weak'; rationale: string; confidence: string | null }>
  exercises: Array<{ slug: string; name: string; category: string; role: ExerciseRole; progression_level: number }>
}

export interface LinkedFinding {
  key: string
  label: string
  zoneLabel: string
  finding: AssessmentFinding
}

const REGION_LABELS: Record<string, string> = {
  head_neck: 'Head & neck',
  shoulder_girdle: 'Shoulder girdle',
  trunk: 'Trunk',
  hip_pelvis: 'Hip & pelvis',
  knee_leg: 'Knee & lower leg',
}

// Matches the dialog's exit animation in MuscleDetailModal.module.css.
const EXIT_MS = 160

function sideColor(state: SideState | null): string | undefined {
  if (!state) return undefined
  return state.role === 'tight' ? STATE_COLORS.tight : STATE_COLORS.weak
}

function SideRow({ label, state }: { label: string; state: SideState | null }) {
  const color = sideColor(state)
  return (
    <div className={styles.sideRow}>
      <span className={styles.sideLabel}>{label}</span>
      <span className={styles.sideDot} style={{ background: color ?? 'var(--hairline)', boxShadow: color ? `0 0 10px ${color}` : undefined }} />
      <span className={state ? undefined : styles.muted}>
        {state ? `${state.role === 'tight' ? 'Tight' : 'Weak'}${state.severity != null ? ` · ${severityWord(state.severity)}` : ''}` : 'No finding'}
      </span>
    </div>
  )
}

export default function MuscleDetailModal({
  slug,
  side,
  findings,
  linkedFindings,
  program,
  onClose,
}: {
  slug: string
  /** The side tapped on the model, when the modal opened from a tap. */
  side: BodySide | null
  /** This assessment's descriptive findings (for per-side state). */
  findings: AssessmentFinding[]
  /** Findings that reference this muscle, with display labels. */
  linkedFindings: LinkedFinding[]
  program: ClinicalProgramReport | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exercise, setExercise] = useState<{ slug: string; name: string } | null>(null)
  const [closing, setClosing] = useState(false)
  const exitTimer = useRef<number | null>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>()

  // Play the exit animation, then unmount (straight away when motion is reduced).
  const requestClose = useCallback(() => {
    if (exitTimer.current != null) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return onClose()
    setClosing(true)
    exitTimer.current = window.setTimeout(onClose, EXIT_MS)
  }, [onClose])
  useEffect(() => () => {
    if (exitTimer.current != null) window.clearTimeout(exitTimer.current)
  }, [])

  // The page behind stays put while the pop-up scrolls.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    // The page keys this modal by slug, so a new muscle remounts it with fresh state.
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(`/api/clinical-content/muscles/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = (await response.json().catch(() => ({}))) as Partial<Detail>
        if (!response.ok || !body.muscle) throw new Error('unavailable')
        setDetail({ muscle: body.muscle, links: body.links ?? [], exercises: body.exercises ?? [] })
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return
        setError('Detailed muscle content is not available for this release.')
      }
    })()
    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exercise) requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose, exercise])

  const sides = useMemo(() => {
    const { states } = findingsToMuscleStates(findings)
    return sidesBySlug(states).find((m) => m.slug === slug) ?? null
  }, [findings, slug])
  const prescribed = useMemo(
    () => prescribedSteps(program, detail?.exercises ?? [], sides),
    [program, detail, sides],
  )
  const libraryOptions = useMemo(() => {
    if (!detail || prescribed.length > 0) return []
    const wanted = new Set<ExerciseRole>()
    if (sides?.left?.role === 'tight' || sides?.right?.role === 'tight') wanted.add('stretch')
    if (sides?.left?.role === 'weak' || sides?.right?.role === 'weak') wanted.add('strengthen')
    const seen = new Set<string>()
    return detail.exercises
      .filter((e) => (wanted.size === 0 || wanted.has(e.role)) && !seen.has(e.slug) && seen.add(e.slug))
      .slice(0, 4)
  }, [detail, prescribed, sides])

  const name = detail?.muscle.name ?? prettySlug(slug)
  const rationaleFor = (key: string) =>
    detail?.links.filter((l) => l.imbalance_key === key).map((l) => l.rationale) ?? []

  // Portaled to <body>: the results page lives inside the app shell's stacking context, under
  // the floating island nav, and a modal must sit above every page chrome.
  return createPortal(
    <>
    <div className={[styles.layer, closing ? styles.closing : ''].filter(Boolean).join(' ')}>
      {/* A sibling of the dialog, not its parent: a blurred ancestor would leave the dialog's own
          glass nothing to blur. */}
      <div className={styles.scrim} onClick={requestClose} aria-hidden />
      <Surface
        tier="feature"
        className={styles.dialog}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
          padding: 0,
          background: 'rgba(8, 10, 14, 0.92)',
        }}
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="muscle-detail-title"
          className={styles.frame}
        >
          <header className={styles.header}>
            <div className={styles.titleBlock}>
              <p className="t-kicker">{detail ? REGION_LABELS[detail.muscle.region] ?? 'Muscle' : 'Muscle'}</p>
              <h2 id="muscle-detail-title" className="t-headline-sm">{name}</h2>
              {sides && (
                <p className={styles.summary}>
                  <span className={styles.summaryDots} aria-hidden>
                    <span style={{ background: sideColor(sides.right) ?? 'var(--hairline)' }} />
                    <span style={{ background: sideColor(sides.left) ?? 'var(--hairline)' }} />
                  </span>
                  {sidesSummary(sides)}
                </p>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className={styles.close}>✕</button>
          </header>

          <div className={styles.body}>
            <section className={styles.section} aria-labelledby="muscle-found">
              <h3 id="muscle-found" className={styles.sectionTitle}>What this scan found</h3>
              {sides ? (
                <div className={styles.sides}>
                  <SideRow label="L" state={sides.left} />
                  <SideRow label="R" state={sides.right} />
                  {side && <p className={styles.muted}>You tapped the {side} side.</p>}
                </div>
              ) : (
                <p className={styles.muted}>No finding in this scan involves this muscle.</p>
              )}
              {linkedFindings.map((f) => (
                <div key={f.key} className={styles.linked}>
                  <p className={styles.linkedLabel}>
                    {f.label} <span className={styles.muted}>· {f.zoneLabel}</span>
                  </p>
                  {rationaleFor(f.key).map((text, i) => (
                    <p key={i} className="t-body">{text}</p>
                  ))}
                </div>
              ))}
            </section>

            <section className={styles.section} aria-labelledby="muscle-program">
              <h3 id="muscle-program" className={styles.sectionTitle}>
                {prescribed.length > 0 ? 'In this program' : 'Correctives'}
              </h3>
              {!detail && !error && <p className={styles.muted}>Loading…</p>}
              {prescribed.length > 0 && (
                <ul className={styles.list}>
                  {prescribed.map(({ step, role, priorityLabel }) => (
                    <li key={step.slug}>
                      <button type="button" className={styles.exercise} onClick={() => setExercise({ slug: step.slug, name: step.name })}>
                        <span>
                          <span className={styles.exerciseName}>{step.name}</span>
                          <span className={styles.muted}>{step.freq} · for {priorityLabel}</span>
                        </span>
                        <Chip band={role === 'stretch' ? 'maintain' : 'info'} size="sm">
                          {role === 'stretch' ? 'Stretch' : 'Strengthen'}
                        </Chip>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {libraryOptions.length > 0 && (
                <>
                  <p className={styles.muted}>Not in this program yet. Options from the exercise library:</p>
                  <ul className={styles.list}>
                    {libraryOptions.map((e) => (
                      <li key={e.slug}>
                        <button type="button" className={styles.exercise} onClick={() => setExercise({ slug: e.slug, name: e.name })}>
                          <span className={styles.exerciseName}>{e.name}</span>
                          <Chip band={e.role === 'stretch' ? 'maintain' : 'info'} size="sm">
                            {e.role === 'stretch' ? 'Stretch' : 'Strengthen'}
                          </Chip>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail && prescribed.length === 0 && libraryOptions.length === 0 && (
                <p className={styles.muted}>No approved exercises target this muscle yet.</p>
              )}
            </section>

            {error && <p className={styles.muted} role="status">{error}</p>}
            {detail && (
              <section className={styles.section} aria-labelledby="muscle-anatomy">
                <h3 id="muscle-anatomy" className={styles.sectionTitle}>Anatomy</h3>
                <p className="t-body">{detail.muscle.anatomy}</p>
                <h3 className={styles.sectionTitle}>What it does</h3>
                <p className="t-body">{detail.muscle.function}</p>
              </section>
            )}

            <footer className={styles.footer}>
              <p>Screening indication, not a diagnosis. Confirm with hands-on testing before prescribing.</p>
              {detail && <Link href={`/muscles/${detail.muscle.slug}`}>Full muscle page</Link>}
            </footer>
          </div>
        </div>
      </Surface>
    </div>
    {/* A sibling, not a child: its own backdrop click must not bubble into this one. */}
    {exercise && <ExerciseDetailSheet slug={exercise.slug} name={exercise.name} onClose={() => setExercise(null)} />}
    </>,
    document.body,
  )
}
