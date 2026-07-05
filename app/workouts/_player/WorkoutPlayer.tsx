'use client'
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { SessionItem, SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import {
  initPlayer,
  playerReducer,
  resumePlayer,
  UP_NEXT_MS,
  PREROLL_MS,
  type PlayerState,
} from '@/lib/workout/playerMachine'
import type { RunItem, RunStatus } from '@/lib/workout/runState'
import type { RatingPace, RatingDifficulty } from '@/lib/workout/rating'
import { useWakeLock } from '@/lib/capture/use-wake-lock'
import { caption, voiceCue } from '@/lib/workout/cues'
import { CountdownRing } from './CountdownRing'
import { RateForm } from './RateForm'

// ---- public contract ----------------------------------------------------
export interface RunPatch {
  status?: RunStatus
  current_item_index?: number
  items?: RunItem[]
  total_duration_ms?: number
  /** Monotonic write counter — the server drops stale/out-of-order patches. */
  revision?: number
  red_flag_acknowledged?: boolean
}
export interface RatingPayload {
  clarity?: number
  pace?: RatingPace
  difficulty?: RatingDifficulty
  feedback_tags: string[]
  notes?: string
}
export interface WorkoutPlayerProps {
  snapshot: SessionSnapshot
  clientFirstName?: string | null
  /** Practitioner path allows a lint-checked note; the public client path does not. */
  allowNotes: boolean
  resume?: { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[]; revision?: number } | null
  /** Fire-and-forget playback persistence (PATCH /run, or localStorage on the token path). */
  saveRun?: (patch: RunPatch) => void
  submitRating: (payload: RatingPayload) => Promise<{ ok: boolean; error?: string }>
  onExit?: () => void
}

// Step colors mirror the results page (PriorityProgram) so the player's accent
// traces the same corrective arc: Loosen → Lengthen → Wake up → Strengthen → Connect.
const STEP_COLOR: Record<string, string> = {
  Loosen: '#F59E0B',
  Lengthen: '#818CF8',
  'Wake up': '#F472B6',
  Strengthen: '#22C55E',
  Connect: '#A78BFA',
}
const ACCENT_FALLBACK = '#818CF8'
const itemColor = (it?: SessionItem): string => (it ? STEP_COLOR[it.stepLabel] ?? ACCENT_FALLBACK : ACCENT_FALLBACK)

function segmentTotalMs(s: PlayerState): number {
  const it = s.items[s.index]
  switch (s.phase) {
    case 'upNext':
      return UP_NEXT_MS
    case 'preroll':
      return PREROLL_MS
    case 'resting':
      return it ? it.timing.restSeconds * 1000 : 1
    case 'playing':
      return it && it.timing.kind === 'hold' ? it.timing.secondsPerSet * 1000 : 1
    default:
      return 1
  }
}

const secs = (ms: number): number => Math.max(0, Math.ceil(ms / 1000))

export function WorkoutPlayer({
  snapshot,
  clientFirstName,
  allowNotes,
  resume,
  saveRun,
  submitRating,
  onExit,
}: WorkoutPlayerProps) {
  const reduceMotion = useReducedMotion()
  const [state, dispatch] = useReducer(
    playerReducer,
    undefined,
    () => (resume ? resumePlayer(snapshot, resume) : initPlayer(snapshot)),
  )
  const { acquire, release } = useWakeLock()
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [captionsOn, setCaptionsOn] = useState(true)
  // Red-flag pre-session safety gate. Must be 'clear' before begin() can run.
  const [redFlag, setRedFlag] = useState<'unasked' | 'clear' | 'stopped'>('unasked')

  const item = state.items[state.index] as SessionItem | undefined
  const accent = itemColor(item)
  const total = state.items.length
  // The player is inert until the red-flag screen is answered clear — a resumed
  // session lands in 'upNext' and must NOT auto-advance past the safety check.
  const active = state.phase !== 'idle' && state.phase !== 'summary' && redFlag === 'clear'

  // ---- timeline clock: one interval, real deltas, paused-aware -----------
  useEffect(() => {
    if (!active || state.paused) return
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      // Clamp the delta: after tab-backgrounding the browser delivers one huge
      // tick. A guided session waits for the user rather than fast-forwarding
      // through segments — and elapsedMs must not count time spent away.
      const delta = Math.min(now - last, 1_000)
      last = now
      dispatch({ type: 'TICK', ms: delta })
    }, 200)
    return () => clearInterval(id)
  }, [active, state.paused, state.phase, state.index, state.set])

  // ---- keep the screen awake while a session is live --------------------
  useEffect(() => {
    if (active) void acquire()
    else release()
  }, [active, acquire, release])

  // ---- warm the next item's clip + poster while the current one plays -----
  useEffect(() => {
    const next = state.items[state.index + 1] as SessionItem | undefined
    if (!next?.media) return
    const img = new Image()
    img.src = next.media.posterUrl
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.src = next.media.loopUrl
    // The browser keeps the fetched bytes in HTTP cache for the real <video>.
    // On a fast skip/exit before the next item plays, abort the in-flight
    // warm-up loads so they don't compete with the clip actually on screen.
    return () => {
      img.src = ''
      v.removeAttribute('src')
      v.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index])

  // ---- on-device voice cue at each phase boundary (Web Speech; on-device) --
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (voiceMuted) {
      window.speechSynthesis.cancel()
      return
    }
    if (redFlag !== 'clear') return
    const cue = voiceCue(state.phase, state.items[state.index], state.set)
    if (!cue) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(cue.speech)
      utterance.rate = 1
      window.speechSynthesis.speak(utterance)
    } catch {
      // Speech is best-effort — the caption always mirrors it on screen.
    }
    // state.items is intentionally omitted: the reducer sets it once at init and
    // never replaces it, so it is a permanently stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.index, state.set, voiceMuted, redFlag])

  // Stop any in-flight speech when the player unmounts.
  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch {} }, [])

  // ---- persist playback state (deduped) for resume + analytics ----------
  const lastSavedRef = useRef('')
  const revisionRef = useRef(resume?.revision ?? 0)
  useEffect(() => {
    if (!saveRun || state.phase === 'idle') return
    const status: RunStatus =
      state.phase === 'summary' ? 'completed' : state.paused ? 'paused' : 'in_progress'
    const items: RunItem[] = snapshot.items.map((it, i) => ({
      slug: it.slug,
      completed: state.results[i].completed,
      skipped: state.results[i].skipped,
    }))
    const patch: RunPatch = {
      status,
      current_item_index: Math.min(state.index, total),
      items,
      total_duration_ms: state.elapsedMs,
      // Idempotent ratchet server-side; guarantees a completing patch always
      // carries the acknowledgement even if the initial clear-time write raced.
      ...(redFlag === 'clear' ? { red_flag_acknowledged: true } : {}),
    }
    const key = JSON.stringify([status, patch.current_item_index, items])
    if (key === lastSavedRef.current) return
    lastSavedRef.current = key
    revisionRef.current += 1
    saveRun({ ...patch, revision: revisionRef.current })
    // elapsedMs is read but intentionally not a dep: it changes every tick, and
    // the key-dedup above already gates writes to meaningful transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRun, snapshot.items, total, state.phase, state.index, state.paused, state.results, redFlag])

  // ---- auto-hiding chrome (Apple-Fitness+ discipline) -------------------
  const [chromeShown, setChromeShown] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canHide = state.phase === 'playing' || state.phase === 'resting'
  const pokeChrome = useCallback(() => {
    setChromeShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChromeShown(false), 3200)
  }, [])
  useEffect(() => {
    if (!canHide) return
    // Auto-hide the transport after entering a play phase / new item. setState
    // runs inside the deferred timer (never synchronously in the effect body).
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChromeShown(false), 3200)
    return () => {
      // hideTimer.current is the single live timer — a later pokeChrome may
      // have replaced ours, so clear whichever is pending (not a captured id)
      // or a phantom timer would hide the chrome right after a tap.
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [canHide, state.index])

  const begin = () => {
    // Unreachable until the pre-session red-flag screen has been answered clear.
    if (redFlag !== 'clear') return
    dispatch({ type: 'START' })
    dispatch({ type: 'ADVANCE' })
  }

  const onRedFlagClear = () => {
    setRedFlag('clear')
    // Best-effort auth-path acknowledgement. On the share-token path saveRun
    // writes to localStorage only (red_flag_acknowledged is silently dropped).
    saveRun?.({ red_flag_acknowledged: true })
  }

  // Off the play phases the chrome is always shown; during play it auto-hides.
  const chromeVisible = !canHide || chromeShown
  const chromeStyle = { opacity: chromeVisible ? 1 : 0, transition: 'opacity 0.4s ease', pointerEvents: chromeVisible ? undefined : ('none' as const) }
  const done = state.results.filter((r) => r.completed).length
  const skipped = state.results.filter((r) => r.skipped).length

  return (
    <div
      onPointerMove={canHide ? pokeChrome : undefined}
      onClick={canHide ? pokeChrome : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#08080A',
        color: '#F5F5F5',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, system-ui, sans-serif',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* full-bleed demo canvas: clip loop → poster → gradient fallback */}
      <DemoCanvas item={item} accent={accent} active={state.phase === 'playing'} reduceMotion={!!reduceMotion} />

      {/* top: segmented progress + exit */}
      {active && (
        <div style={{ position: 'relative', zIndex: 3, padding: '14px 16px 0', ...chromeStyle }}>
          <SegmentedProgress total={total} index={state.index} results={state.results} accent={accent} />
        </div>
      )}
      {onExit && (
        <button
          onClick={onExit}
          aria-label="Exit session"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 5,
            width: 40,
            height: 40,
            minHeight: 40,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(0,0,0,0.35)',
            color: '#D4D4D8',
            fontSize: 18,
            cursor: 'pointer',
            ...chromeStyle,
          }}
        >
          ✕
        </button>
      )}

      {/* voice + caption toggles */}
      {active && (
        <div style={{ position: 'absolute', top: onExit ? 60 : 12, right: 12, zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8, ...chromeStyle }}>
          <button
            onClick={() => setVoiceMuted((m) => !m)}
            aria-label={voiceMuted ? 'Unmute coach voice' : 'Mute coach voice'}
            aria-pressed={voiceMuted}
            style={roundToggle(!voiceMuted)}
          >
            {voiceMuted ? '🔇' : '🔊'}
          </button>
          <button
            onClick={() => setCaptionsOn((c) => !c)}
            aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
            aria-pressed={captionsOn}
            style={{ ...roundToggle(captionsOn), fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' }}
          >
            CC
          </button>
        </div>
      )}

      {/* phase content */}
      <div style={{ position: 'relative', zIndex: 3, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 20px', textAlign: 'center' }}>
        <AnimatePresence mode="wait">
          {redFlag === 'unasked' && state.phase !== 'summary' && (
            <Fade key="redflag" reduce={!!reduceMotion}>
              <RedFlagCard
                accent={accent}
                onClear={onRedFlagClear}
                onStop={() => setRedFlag('stopped')}
              />
            </Fade>
          )}

          {redFlag === 'stopped' && state.phase !== 'summary' && (
            <Fade key="stopped" reduce={!!reduceMotion}>
              <StopCard onDismiss={onExit} />
            </Fade>
          )}

          {redFlag === 'clear' && (state.phase === 'idle' || state.phase === 'intro') && (
            <Fade key="intro" reduce={!!reduceMotion}>
              <StartCard snapshot={snapshot} clientFirstName={clientFirstName} onBegin={begin} accent={accent} />
            </Fade>
          )}

          {redFlag === 'clear' && state.phase === 'upNext' && item && (
            <Fade key={`upnext-${state.index}`} reduce={!!reduceMotion}>
              <UpNext item={item} index={state.index} total={total} accent={accent} onStart={() => dispatch({ type: 'ADVANCE' })} />
            </Fade>
          )}

          {redFlag === 'clear' && state.phase === 'preroll' && item && (
            <Fade key={`preroll-${state.index}`} reduce={!!reduceMotion}>
              <div>
                <div style={{ fontSize: '0.9rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: accent, marginBottom: 8 }}>Get ready</div>
                <div style={{ fontSize: '7rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{secs(state.remainingMs)}</div>
                <div style={{ marginTop: 10, color: '#D4D4D8', fontWeight: 600 }}>{item.name}</div>
              </div>
            </Fade>
          )}

          {redFlag === 'clear' && (state.phase === 'playing' || state.phase === 'resting') && item && (
            <Fade key="playing" reduce={!!reduceMotion}>
              <PlayingHud state={state} item={item} accent={accent} captionText={captionsOn ? caption(state.phase, item) : ''} onNext={() => dispatch({ type: 'NEXT' })} />
            </Fade>
          )}

          {state.phase === 'summary' && (
            <Fade key="summary" reduce={!!reduceMotion}>
              <RateForm
                done={done}
                skipped={skipped}
                total={total}
                durationSec={state.elapsedMs > 0 ? Math.round(state.elapsedMs / 1000) : snapshot.estimatedDurationSec}
                disclaimer={snapshot.disclaimer}
                allowNotes={allowNotes}
                submitRating={submitRating}
                onExit={onExit}
              />
            </Fade>
          )}
        </AnimatePresence>
      </div>

      {/* transport */}
      {(state.phase === 'playing' || state.phase === 'resting') && (
        <div style={{ position: 'relative', zIndex: 4, padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 22px)', ...chromeStyle }}>
          <Transport
            paused={state.paused}
            onBack={() => dispatch({ type: 'BACK' })}
            onPauseToggle={() => dispatch({ type: state.paused ? 'RESUME' : 'PAUSE' })}
            onSkip={() => dispatch({ type: 'SKIP' })}
            atStart={state.index === 0}
          />
        </div>
      )}
    </div>
  )
}

// ---- entrance/exit fade wrapper -----------------------------------------
function Fade({ children, reduce }: { children: React.ReactNode; reduce: boolean }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      style={{ width: '100%', maxWidth: 460 }}
    >
      {children}
    </motion.div>
  )
}

// ---- full-bleed demo placeholder ----------------------------------------
// Memoized: the parent re-renders on every 200ms TICK, but these props only
// change on item/phase transitions — skip the reconciliation on ticks. (results
// keeps a stable array identity across ticks; the reducer only replaces it on a
// real transition.)
const DemoCanvas = memo(function DemoCanvas({ item, accent, active, reduceMotion }: { item?: SessionItem; accent: string; active: boolean; reduceMotion: boolean }) {
  // True three-tier fallback: clip loop → its poster (video 404s/decode-fails)
  // → today's gradient (poster also fails, or there is no media). Each tier
  // steps down independently and both flags re-arm on the next item.
  const [videoFailed, setVideoFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  // Reset media-fallback flags when the exercise changes — adjusted during
  // render (not an effect) so the stale-poster frame never commits.
  const [prevSlug, setPrevSlug] = useState(item?.slug)
  if (item?.slug !== prevSlug) {
    setPrevSlug(item?.slug)
    setVideoFailed(false)
    setPosterFailed(false)
  }
  const media = item?.media
  const showVideo = !!media && !videoFailed
  const showPoster = !!media && videoFailed && !posterFailed
  const showGradient = !media || (videoFailed && posterFailed)

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'hidden' }}>
      {/* gradient underlay always renders — the video sits above it, so a slow clip fades in over brand, not black */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(120% 80% at 50% 18%, ${accent}22 0%, transparent 55%), radial-gradient(90% 60% at 50% 108%, ${accent}18 0%, transparent 60%), #08080A`,
          transition: 'background 0.8s ease',
        }}
      />
      {showGradient && (
        <motion.div
          animate={reduceMotion ? undefined : { scale: active ? [1, 1.08, 1] : 1, opacity: active ? [0.5, 0.75, 0.5] : 0.35 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            top: '34%',
            left: '50%',
            width: 460,
            height: 460,
            marginLeft: -230,
            marginTop: -230,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${accent}55 0%, ${accent}00 68%)`,
            filter: 'blur(20px)',
          }}
        />
      )}
      {showVideo && (
        <video
          key={item!.slug}
          src={media!.loopUrl}
          poster={media!.posterUrl}
          muted
          loop
          playsInline
          preload="auto"
          autoPlay={!reduceMotion}
          onError={() => setVideoFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: active ? 0.92 : 0.55,
            transition: 'opacity 0.6s ease',
          }}
        />
      )}
      {showPoster && (
        // Video broke but a valid poster exists — show the static frame rather
        // than dropping straight to the gradient. Its own onError steps down.
        <img
          key={`${item!.slug}-poster`}
          src={media!.posterUrl}
          alt=""
          onError={() => setPosterFailed(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: active ? 0.92 : 0.55,
            transition: 'opacity 0.6s ease',
          }}
        />
      )}
      {(showVideo || showPoster) && (
        // scrim keeps the white HUD/caption legible over bright clip/poster frames
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(8,8,10,0.55) 0%, rgba(8,8,10,0.18) 38%, rgba(8,8,10,0.72) 100%)',
          }}
        />
      )}
      {showGradient && item && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            fontSize: 'clamp(2.4rem, 9vw, 4.6rem)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'rgba(255,255,255,0.05)',
            textAlign: 'center',
            padding: '20% 24px 0',
            lineHeight: 1.05,
            userSelect: 'none',
          }}
        >
          {item.name}
        </div>
      )}
    </div>
  )
})

// ---- segmented progress -------------------------------------------------
const SegmentedProgress = memo(function SegmentedProgress({ total, index, results, accent }: { total: number; index: number; results: { completed: boolean; skipped: boolean }[]; accent: string }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => {
        const r = results[i]
        const isPast = i < index
        const fill = r?.completed ? accent : r?.skipped ? 'rgba(255,255,255,0.35)' : isPast ? accent : i === index ? `${accent}88` : 'rgba(255,255,255,0.14)'
        return <div key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: fill, transition: 'background 0.3s ease' }} />
      })}
    </div>
  )
})

// ---- start card ---------------------------------------------------------
function StartCard({ snapshot, clientFirstName, onBegin, accent }: { snapshot: SessionSnapshot; clientFirstName?: string | null; onBegin: () => void; accent: string }) {
  const mins = Math.max(1, Math.round(snapshot.estimatedDurationSec / 60))
  return (
    <div>
      {clientFirstName && <div style={{ color: accent, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 8 }}>Hi {clientFirstName}</div>}
      <h1 style={{ fontSize: 'clamp(1.8rem, 6vw, 2.6rem)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 10px' }}>Your guided session</h1>
      <p style={{ color: '#A1A1AA', fontSize: '0.95rem', margin: '0 0 4px' }}>
        {snapshot.items.length} movements · about {mins} min
      </p>
      <p style={{ color: '#71717A', fontSize: '0.8rem', lineHeight: 1.5, margin: '14px auto 22px', maxWidth: 360 }}>{snapshot.disclaimer}</p>
      <button
        onClick={onBegin}
        style={{
          padding: '15px 40px',
          minHeight: 56,
          borderRadius: 999,
          border: 'none',
          background: accent,
          color: '#0A0A0B',
          fontWeight: 800,
          fontSize: '1.05rem',
          cursor: 'pointer',
          boxShadow: `0 10px 30px ${accent}44`,
        }}
      >
        Begin session
      </button>
    </div>
  )
}

// ---- up next ------------------------------------------------------------
function UpNext({ item, index, total, accent, onStart }: { item: SessionItem; index: number; total: number; accent: string; onStart: () => void }) {
  return (
    <div>
      <div style={{ fontSize: '0.78rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 10 }}>
        Up next · {index + 1} of {total}
      </div>
      <div style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 999, background: `${accent}22`, color: accent, fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
        {item.stepLabel}
      </div>
      <h2 style={{ fontSize: 'clamp(1.6rem, 6vw, 2.3rem)', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.02em' }}>{item.name}</h2>
      <p style={{ color: '#A1A1AA', fontSize: '0.9rem', margin: '0 0 6px' }}>{timingLabel(item)}</p>
      <p style={{ color: '#8A8A93', fontSize: '0.82rem', lineHeight: 1.5, maxWidth: 380, margin: '10px auto 12px' }}>{item.priorityLabel}</p>
      {item.steps && item.steps.length > 0 && (
        <ol
          style={{
            textAlign: 'left',
            maxWidth: 380,
            margin: '0 auto 22px',
            padding: '0 0 0 20px',
            color: '#A1A1AA',
            fontSize: '0.85rem',
            lineHeight: 1.55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {item.steps.slice(0, 5).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <button
        onClick={onStart}
        style={{ padding: '13px 34px', minHeight: 52, borderRadius: 999, border: `1px solid ${accent}`, background: 'transparent', color: accent, fontWeight: 700, fontSize: '0.98rem', cursor: 'pointer' }}
      >
        Start now →
      </button>
    </div>
  )
}

// ---- playing / resting HUD ---------------------------------------------
function PlayingHud({ state, item, accent, captionText, onNext }: { state: PlayerState; item: SessionItem; accent: string; captionText: string; onNext: () => void }) {
  const isRest = state.phase === 'resting'
  const isHold = item.timing.kind === 'hold'
  const repsPerSet = item.timing.kind === 'reps' ? item.timing.repsPerSet : 0
  const totalMs = segmentTotalMs(state)
  const progress = isRest || isHold ? state.remainingMs / totalMs : 1
  const ringColor = isRest ? '#A1A1AA' : accent

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ minHeight: 22, color: '#D4D4D8', fontWeight: 600, fontSize: '0.95rem' }}>
        {isRest ? 'Rest' : item.name}
        {!isRest && <span style={{ color: '#71717A' }}> · set {state.set} of {item.timing.sets}</span>}
      </div>

      {isRest || isHold ? (
        <CountdownRing progress={progress} color={ringColor} dimmed={isRest}>
          <div style={{ fontSize: '4.4rem', fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{secs(state.remainingMs)}</div>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A1A1AA' }}>{isRest ? 'seconds' : 'hold'}</div>
        </CountdownRing>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#A1A1AA' }}>Target</div>
          <div style={{ fontSize: '4.6rem', fontWeight: 800, lineHeight: 1, color: accent }}>×{repsPerSet}</div>
          <div style={{ fontSize: '0.9rem', color: '#A1A1AA' }}>controlled reps</div>
        </div>
      )}

      {/* caption (mirrors the voice cue added in the voice pass) */}
      <p aria-live="polite" style={{ minHeight: 20, maxWidth: 360, color: '#8A8A93', fontSize: '0.82rem', lineHeight: 1.5, margin: 0 }}>
        {captionText}
      </p>

      {!isRest && !isHold && (
        <button
          onClick={onNext}
          style={{ padding: '13px 40px', minHeight: 52, borderRadius: 999, border: 'none', background: accent, color: '#0A0A0B', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', boxShadow: `0 8px 24px ${accent}44` }}
        >
          Done, next →
        </button>
      )}
    </div>
  )
}

function Transport({ paused, onBack, onPauseToggle, onSkip, atStart }: { paused: boolean; onBack: () => void; onPauseToggle: () => void; onSkip: () => void; atStart: boolean }) {
  const btn = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; icon?: string } = {}) => (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={opts.disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minWidth: opts.primary ? 108 : 64,
        minHeight: 52,
        padding: '0 18px',
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.14)',
        background: opts.primary ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.3)',
        color: opts.disabled ? '#52525B' : '#F5F5F5',
        fontWeight: 700,
        fontSize: '0.9rem',
        cursor: opts.disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {opts.icon && <span aria-hidden="true">{opts.icon}</span>}
      {label}
    </button>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      {btn('Back', onBack, { disabled: atStart })}
      {btn(paused ? 'Resume' : 'Pause', onPauseToggle, { primary: true, icon: paused ? '▶' : '❚❚' })}
      {btn('Skip', onSkip)}
    </div>
  )
}

function roundToggle(on: boolean): React.CSSProperties {
  return {
    width: 40,
    height: 40,
    minHeight: 40,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.14)',
    background: on ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.35)',
    color: on ? '#F5F5F5' : '#71717A',
    fontSize: 16,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}

// ---- red-flag pre-session safety screen ---------------------------------
function RedFlagCard({ accent, onClear, onStop }: { accent: string; onClear: () => void; onStop: () => void }) {
  return (
    <div>
      <h2 style={{ fontSize: 'clamp(1.3rem, 5vw, 1.9rem)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 20px', lineHeight: 1.2 }}>
        Before you start — are you feeling any sharp or worsening pain right now?
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <button
          onClick={onClear}
          data-testid="red-flag-no"
          style={{
            padding: '15px 40px',
            minHeight: 56,
            width: '100%',
            maxWidth: 320,
            borderRadius: 999,
            border: 'none',
            background: accent,
            color: '#0A0A0B',
            fontWeight: 800,
            fontSize: '1.05rem',
            cursor: 'pointer',
            boxShadow: `0 10px 30px ${accent}44`,
          }}
        >
          No, I feel okay
        </button>
        <button
          onClick={onStop}
          data-testid="red-flag-yes"
          style={{
            padding: '13px 40px',
            minHeight: 52,
            width: '100%',
            maxWidth: 320,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'transparent',
            color: '#D4D4D8',
            fontWeight: 700,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Yes
        </button>
      </div>
    </div>
  )
}

// ---- stop card (shown when user reports pain) ----------------------------
function StopCard({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div data-testid="stop-card">
      <h2 style={{ fontSize: 'clamp(1.3rem, 5vw, 1.9rem)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 16px', lineHeight: 1.2 }}>
        Let&apos;s pause here.
      </h2>
      <p style={{ color: '#A1A1AA', fontSize: '0.97rem', lineHeight: 1.6, margin: '0 0 28px', maxWidth: 360 }}>
        Sharp pain is worth checking with a movement professional before continuing.
      </p>
      <button
        onClick={onDismiss}
        data-testid="stop-card-dismiss"
        style={{
          padding: '13px 34px',
          minHeight: 52,
          borderRadius: 999,
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'transparent',
          color: '#D4D4D8',
          fontWeight: 700,
          fontSize: '0.98rem',
          cursor: 'pointer',
        }}
      >
        End session
      </button>
    </div>
  )
}

function timingLabel(item: SessionItem): string {
  const t = item.timing
  if (t.kind === 'hold') {
    return `${t.sets} × ${t.secondsPerSet}s hold${t.sets > 1 ? ` · ${t.restSeconds}s rest` : ''}`
  }
  return `${t.sets} × ${t.repsPerSet} reps${t.sets > 1 ? ` · ${t.restSeconds}s rest` : ''}`
}
