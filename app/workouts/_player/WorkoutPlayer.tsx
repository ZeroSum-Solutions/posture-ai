'use client'
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { workoutCoachCueUrl } from '@/lib/workout/voicePack'
import { CountdownRing } from './CountdownRing'
import { RateForm, WorkoutLegalNotice } from './RateForm'
import { AudioGlyph } from '@/components/SignalGlyphs'
import { colorMix, workoutTheme as theme } from './theme'

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
  Loosen: theme.warning,
  Lengthen: theme.primary,
  'Wake up': theme.copper,
  Strengthen: theme.maintain,
  Connect: theme.primary,
}
const ACCENT_FALLBACK = theme.primary
const itemColor = (it?: SessionItem): string => (it ? STEP_COLOR[it.stepLabel] ?? ACCENT_FALLBACK : ACCENT_FALLBACK)

const panelStyle: React.CSSProperties = {
  width: '100%',
  border: `1px solid ${theme.border}`,
  borderRadius: theme.radiusCard,
  background: `linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.012) 42%, rgba(255,255,255,.025)), ${theme.surface}`,
  boxShadow: 'inset 0 1px 0 var(--glass-highlight), inset 0 -1px 0 rgba(0,0,0,.52), 0 8px 24px rgba(0,0,0,.38)',
  WebkitBackdropFilter: 'blur(28px) saturate(145%)',
  backdropFilter: 'blur(28px) saturate(145%)',
  padding: '32px',
}

const uiFont = 'var(--font-ui, Inter), system-ui, sans-serif'

const primaryButtonStyle = (): React.CSSProperties => ({
  minHeight: 52,
  border: '1px solid transparent',
  borderRadius: theme.radiusControl,
  background: `linear-gradient(#060606,#060606) padding-box, ${theme.gradient} border-box`,
  color: theme.textPrimary,
  fontFamily: uiFont,
  fontSize: '1rem',
  fontWeight: 700,
  cursor: 'pointer',
})

const secondaryButtonStyle = (accent: string): React.CSSProperties => ({
  minHeight: 52,
  border: `1px solid ${accent}`,
  borderRadius: theme.radiusControl,
  background: theme.surfaceWell,
  color: theme.textPrimary,
  fontFamily: uiFont,
  fontSize: '0.98rem',
  fontWeight: 600,
  cursor: 'pointer',
})

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

  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const stopCoachVoice = useCallback(() => {
    const audio = voiceAudioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      voiceAudioRef.current = null
    }
    try { window.speechSynthesis?.cancel() } catch {}
  }, [])

  // ---- Voicebox River cue at each phase boundary; Web Speech is fallback ---
  useEffect(() => {
    if (typeof window === 'undefined') return
    stopCoachVoice()
    if (voiceMuted) {
      return
    }
    if (redFlag !== 'clear') return
    const cue = voiceCue(state.phase, state.items[state.index], state.set)
    if (!cue) return

    let cancelled = false
    let fallbackStarted = false
    const fallbackToWebSpeech = () => {
      if (cancelled || fallbackStarted || !('speechSynthesis' in window)) return
      fallbackStarted = true
      try {
        const utterance = new SpeechSynthesisUtterance(cue.speech)
        utterance.rate = 1
        window.speechSynthesis.speak(utterance)
      } catch {
        // Speech is best-effort — the caption always mirrors it on screen.
      }
    }

    const audio = new Audio(workoutCoachCueUrl(cue.speech))
    audio.preload = 'auto'
    voiceAudioRef.current = audio
    audio.addEventListener('error', fallbackToWebSpeech, { once: true })
    audio.load()
    void audio.play().catch(fallbackToWebSpeech)

    return () => {
      cancelled = true
      audio.removeEventListener('error', fallbackToWebSpeech)
      if (voiceAudioRef.current === audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        voiceAudioRef.current = null
      }
    }
    // state.items is intentionally omitted: the reducer sets it once at init and
    // never replaces it, so it is a permanently stable reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.index, state.set, voiceMuted, redFlag, stopCoachVoice])

  // Stop any in-flight speech when the player unmounts.
  useEffect(() => () => stopCoachVoice(), [stopCoachVoice])

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

  // When the item changes, show the transport again so a stale `false` from the
  // previous item's auto-hide doesn't leave the next item's chrome hidden and
  // unclickable from its first frame (the auto-hide effect below re-arms the timer).
  // Adjusting state during render is React's pattern for resetting on a changed
  // value — no effect, no synchronous-setState-in-effect cascade.
  const [chromeItemIndex, setChromeItemIndex] = useState(state.index)
  if (state.index !== chromeItemIndex) {
    setChromeItemIndex(state.index)
    setChromeShown(true)
  }
  const hideChrome = useCallback(() => {
    const focused = document.activeElement
    if (focused instanceof Element && focused.closest('[data-workout-chrome-controls]')) return
    setChromeShown(false)
  }, [])
  const pokeChrome = useCallback(() => {
    setChromeShown(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(hideChrome, 3200)
  }, [hideChrome])
  useEffect(() => {
    if (!canHide) return
    // Auto-hide the transport after entering a play phase / new item. setState
    // runs inside the deferred timer (never synchronously in the effect body).
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(hideChrome, 3200)
    return () => {
      // hideTimer.current is the single live timer — a later pokeChrome may
      // have replaced ours, so clear whichever is pending (not a captured id)
      // or a phantom timer would hide the chrome right after a tap.
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [canHide, hideChrome, state.index])

  useEffect(() => {
    if (!canHide) return
    const revealOnKeyboardIntent = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      // Commit visibility + tab-order changes before the browser moves focus.
      const wasHidden = !chromeShown
      flushSync(pokeChrome)
      if (!wasHidden) return

      // The player is a fixed overlay inside the app shell. Starting native
      // traversal from document.body would otherwise reach obscured shell
      // navigation before the newly revealed player chrome.
      event.preventDefault()
      document
        .querySelector<HTMLElement>('[data-workout-chrome-controls][tabindex="0"]')
        ?.focus()
    }
    document.addEventListener('keydown', revealOnKeyboardIntent, true)
    return () => document.removeEventListener('keydown', revealOnKeyboardIntent, true)
  }, [canHide, chromeShown, pokeChrome])

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
  const chromeStyle = {
    opacity: chromeVisible ? 1 : 0,
    visibility: chromeVisible ? ('visible' as const) : ('hidden' as const),
    transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
    pointerEvents: chromeVisible ? undefined : ('none' as const),
  }
  const done = state.results.filter((r) => r.completed).length
  const skipped = state.results.filter((r) => r.skipped).length

  return (
    <div
      data-immersive-surface
      onPointerMove={canHide ? pokeChrome : undefined}
      onClick={canHide ? pokeChrome : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: theme.background,
        color: theme.textPrimary,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: uiFont,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* full-bleed demo canvas: clip loop → poster → gradient fallback */}
      <DemoCanvas item={item} active={state.phase === 'playing'} reduceMotion={!!reduceMotion} />

      {/* top: segmented progress + exit */}
      {active && (
        <div data-testid="workout-chrome-progress" aria-hidden={!chromeVisible} style={{ position: 'relative', zIndex: 3, padding: `14px ${onExit ? 112 : 16}px 0 16px`, ...chromeStyle }}>
          <SegmentedProgress total={total} index={state.index} results={state.results} accent={accent} />
        </div>
      )}
      {onExit && (
        <button
          onClick={onExit}
          aria-label="Exit session"
          tabIndex={0}
          data-workout-chrome-controls
          style={{
            position: 'absolute',
            top: 'max(12px, env(safe-area-inset-top, 0px))',
            right: 'max(12px, env(safe-area-inset-right, 0px))',
            zIndex: 6,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '0 14px',
            height: 44,
            minHeight: 44,
            borderRadius: theme.radiusControl,
            border: `1px solid ${colorMix(theme.textPrimary, 18)}`,
            background: colorMix(theme.background, 84),
            color: theme.textPrimary,
            fontFamily: uiFont,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.01em',
            WebkitBackdropFilter: 'blur(18px)',
            backdropFilter: 'blur(18px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.36)',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>×</span>
          <span>Exit</span>
        </button>
      )}

      {/* voice + caption toggles */}
      {active && (
        <div data-testid="workout-chrome-toggles" data-workout-chrome-controls aria-hidden={!chromeVisible} style={{ position: 'absolute', top: onExit ? 'calc(max(12px, env(safe-area-inset-top, 0px)) + 56px)' : 'max(12px, env(safe-area-inset-top, 0px))', right: 'max(12px, env(safe-area-inset-right, 0px))', zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8, ...chromeStyle }}>
          <button
            onClick={() => setVoiceMuted((m) => !m)}
            aria-label={voiceMuted ? 'Unmute coach voice' : 'Mute coach voice'}
            aria-pressed={voiceMuted}
            tabIndex={chromeVisible ? 0 : -1}
            style={roundToggle(!voiceMuted)}
          >
            <AudioGlyph muted={voiceMuted} />
          </button>
          <button
            onClick={() => setCaptionsOn((c) => !c)}
            aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
            aria-pressed={captionsOn}
            tabIndex={chromeVisible ? 0 : -1}
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
                <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '0.9rem', letterSpacing: 0, textTransform: 'uppercase', color: accent, marginBottom: 8, fontFeatureSettings: '"zero" 1' }}>Get ready</div>
                <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '7rem', fontWeight: 300, lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"zero" 1' }}>{secs(state.remainingMs)}</div>
                <div style={{ marginTop: 10, color: theme.textSecondary, fontWeight: 600 }}>{item.name}</div>
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
                {...(snapshot.version === 1
                  ? { legacyDisclaimer: snapshot.disclaimer }
                  : { legalNotice: snapshot.legalNotice })}
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
        <div data-testid="workout-chrome-transport" data-workout-chrome-controls aria-hidden={!chromeVisible} style={{ position: 'relative', zIndex: 4, padding: '0 20px calc(env(safe-area-inset-bottom, 0px) + 22px)', ...chromeStyle }}>
          <Transport
            paused={state.paused}
            onBack={() => dispatch({ type: 'BACK' })}
            onPauseToggle={() => dispatch({ type: state.paused ? 'RESUME' : 'PAUSE' })}
            onSkip={() => dispatch({ type: 'SKIP' })}
            atStart={state.index === 0}
            isVisible={chromeVisible}
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
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: reduce ? 0.12 : 0.24, ease: [0.16, 1, 0.3, 1] }}
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
const DemoCanvas = memo(function DemoCanvas({ item, active, reduceMotion }: { item?: SessionItem; active: boolean; reduceMotion: boolean }) {
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
          background: `linear-gradient(90deg, transparent calc(50% - 0.75px), ${colorMix(theme.primary, 34)} calc(50% - 0.75px), ${colorMix(theme.primary, 34)} calc(50% + 0.75px), transparent calc(50% + 0.75px)), linear-gradient(180deg, ${theme.background} 0%, ${theme.backgroundSunken} 100%)`,
        }}
      />
      {showGradient && (
        <div
          style={{
            position: 'absolute',
            top: '18%',
            bottom: '14%',
            left: '50%',
            width: 1.5,
            background: colorMix(theme.primary, active && !reduceMotion ? 44 : 28),
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
            opacity: active ? 0.72 : 0.42,
            transition: 'opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)',
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
            opacity: active ? 0.72 : 0.42,
            transition: 'opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      )}
      {(showVideo || showPoster) && (
        // scrim keeps the white HUD/caption legible over bright clip/poster frames
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(180deg, ${colorMix(theme.background, 88)} 0%, ${colorMix(theme.background, 46)} 42%, ${colorMix(theme.background, 92)} 100%)`,
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
            fontFamily: uiFont,
            fontSize: '56px',
            fontWeight: 700,
            letterSpacing: 0,
            color: colorMix(theme.primary, 8),
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
        const fill = r?.completed ? accent : r?.skipped ? theme.borderStrong : isPast ? accent : i === index ? colorMix(accent, 52) : theme.border
        return <div key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: fill }} />
      })}
    </div>
  )
})

// ---- start card ---------------------------------------------------------
function StartCard({ snapshot, clientFirstName, onBegin, accent }: { snapshot: SessionSnapshot; clientFirstName?: string | null; onBegin: () => void; accent: string }) {
  const mins = Math.max(1, Math.round(snapshot.estimatedDurationSec / 60))
  return (
    <div style={panelStyle}>
      {clientFirstName && <div style={{ color: accent, fontFamily: 'var(--font-data, monospace)', fontWeight: 400, letterSpacing: 0, marginBottom: 8, fontFeatureSettings: '"zero" 1' }}>Hi {clientFirstName}</div>}
      <h1 style={{ fontFamily: uiFont, fontSize: '40px', fontWeight: 700, letterSpacing: 0, lineHeight: 1.08, margin: '0 0 10px' }}>Your guided session</h1>
      <p style={{ color: theme.textSecondary, fontSize: '0.95rem', margin: '0 0 4px' }}>
        {snapshot.items.length} movements · about {mins} min
      </p>
      <WorkoutLegalNotice
        {...(snapshot.version === 1
          ? { legacyDisclaimer: snapshot.disclaimer }
          : { legalNotice: snapshot.legalNotice })}
      />
      <button
        onClick={onBegin}
        style={{
          ...primaryButtonStyle(),
          padding: '15px 40px',
          minHeight: 56,
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
    <div style={panelStyle}>
      <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '0.78rem', letterSpacing: 0, textTransform: 'uppercase', color: theme.textSecondary, marginBottom: 10, fontFeatureSettings: '"zero" 1' }}>
        Up next · {index + 1} of {total}
      </div>
      <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: colorMix(accent, 14), color: accent, fontWeight: 600, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: 0, marginBottom: 12 }}>
        {item.stepLabel}
      </div>
      <h2 style={{ fontFamily: uiFont, fontSize: '34px', fontWeight: 700, lineHeight: 1.08, margin: '0 0 8px', letterSpacing: 0 }}>{item.name}</h2>
      <p style={{ color: theme.textSecondary, fontSize: '0.9rem', margin: '0 0 6px' }}>{timingLabel(item)}</p>
      <p style={{ color: theme.textSecondary, fontSize: '0.82rem', lineHeight: 1.5, maxWidth: 380, margin: '10px auto 12px' }}>{item.priorityLabel}</p>
      {item.steps && item.steps.length > 0 && (
        <ol
          style={{
            textAlign: 'left',
            maxWidth: 380,
            margin: '0 auto 22px',
            padding: '0 0 0 20px',
            color: theme.textSecondary,
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
      <button onClick={onStart} style={{ ...secondaryButtonStyle(accent), padding: '13px 34px' }}>
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
  const ringColor = isRest ? theme.textSecondary : accent

  return (
    <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ minHeight: 22, color: theme.textSecondary, fontWeight: 600, fontSize: '0.95rem' }}>
        {isRest ? 'Rest' : item.name}
        {!isRest && <span style={{ color: theme.textSecondary }}> · set {state.set} of {item.timing.sets}</span>}
      </div>

      {isRest || isHold ? (
        <CountdownRing progress={progress} color={ringColor} dimmed={isRest}>
          <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '4.4rem', fontWeight: 300, lineHeight: 1, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"zero" 1' }}>{secs(state.remainingMs)}</div>
          <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '0.78rem', letterSpacing: 0, textTransform: 'uppercase', color: theme.textSecondary, fontFeatureSettings: '"zero" 1' }}>{isRest ? 'seconds' : 'hold'}</div>
        </CountdownRing>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '0.78rem', letterSpacing: 0, textTransform: 'uppercase', color: theme.textSecondary, fontFeatureSettings: '"zero" 1' }}>Target</div>
          <div style={{ fontFamily: 'var(--font-data, monospace)', fontSize: '4.6rem', fontWeight: 300, lineHeight: 1, color: accent, fontFeatureSettings: '"zero" 1' }}>×{repsPerSet}</div>
          <div style={{ fontSize: '0.9rem', color: theme.textSecondary }}>controlled reps</div>
        </div>
      )}

      {/* caption (mirrors the voice cue added in the voice pass) */}
      <p aria-live="polite" style={{ minHeight: 20, maxWidth: 360, color: theme.textSecondary, fontSize: '0.82rem', lineHeight: 1.5, margin: 0 }}>
        {captionText}
      </p>

      {!isRest && !isHold && (
        <button
          onClick={onNext}
          style={{ ...primaryButtonStyle(), padding: '13px 40px' }}
        >
          Done, next →
        </button>
      )}
    </div>
  )
}

function Transport({ paused, onBack, onPauseToggle, onSkip, atStart, isVisible }: { paused: boolean; onBack: () => void; onPauseToggle: () => void; onSkip: () => void; atStart: boolean; isVisible: boolean }) {
  const btn = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; icon?: string } = {}) => (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={opts.disabled}
      tabIndex={isVisible ? 0 : -1}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minWidth: opts.primary ? 108 : 64,
        minHeight: 52,
        padding: '0 18px',
        borderRadius: theme.radiusControl,
        border: `1px solid ${opts.primary ? theme.primary : theme.border}`,
        background: opts.primary ? theme.primaryStrong : theme.surfaceWell,
        color: opts.disabled ? theme.textSecondary : theme.textPrimary,
        fontFamily: uiFont,
        fontWeight: 600,
        fontSize: '0.9rem',
        cursor: opts.disabled ? 'not-allowed' : 'pointer',
        opacity: opts.disabled ? 0.5 : 1,
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
    width: 44,
    height: 44,
    minHeight: 44,
    borderRadius: theme.radiusControl,
    border: `1px solid ${on ? theme.primary : theme.border}`,
    background: on ? colorMix(theme.primary, 14) : theme.surfaceWell,
    color: on ? theme.primary : theme.textSecondary,
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
    <div style={panelStyle}>
      <h2 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: 0, margin: '0 0 20px', lineHeight: 1.12 }}>
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
            ...primaryButtonStyle(),
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
            ...secondaryButtonStyle(accent),
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
    <div data-testid="stop-card" style={panelStyle}>
      <h2 style={{ fontSize: '32px', fontWeight: 700, letterSpacing: 0, margin: '0 0 16px', lineHeight: 1.12 }}>
        Let&apos;s pause here.
      </h2>
      <p style={{ color: theme.textSecondary, fontSize: '0.97rem', lineHeight: 1.6, margin: '0 auto 28px', maxWidth: 360 }}>
        Sharp pain is worth checking with a movement professional before continuing.
      </p>
      <button
        onClick={onDismiss}
        data-testid="stop-card-dismiss"
        style={{
          padding: '13px 34px',
          minHeight: 52,
          ...secondaryButtonStyle(theme.textSecondary),
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
