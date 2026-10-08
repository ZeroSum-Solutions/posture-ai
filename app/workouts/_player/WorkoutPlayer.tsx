'use client'
import { memo, useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
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
import { Surface } from '@/components/array/Surface'
import { Button, IconButton, SlotNumber } from '@/components/ui'
import Icon from '@/components/array/Icon'
import { haptic } from '@/lib/haptics'
import { spring } from '@/lib/motion'
import styles from './WorkoutPlayer.module.css'
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
  /** Browser speech keeps public prototype playback independent of gated audio assets. */
  voiceMode?: 'recorded' | 'browser'
  resume?: { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[]; revision?: number } | null
  /** Fire-and-forget playback persistence (PATCH /run, or localStorage on the token path). */
  saveRun?: (patch: RunPatch) => void
  submitRating: (payload: RatingPayload) => Promise<{ ok: boolean; error?: string }>
  onExit?: () => void
}

// Step colors mirror the results page (PriorityProgram) so the player's accent
// traces the same corrective arc: Loosen → Lengthen → Wake up → Strengthen → Connect.
//
// Literals, not theme aliases, and they must stay identical to PriorityProgram's
// STEP_COLOR. Routing them through the theme is what broke this: theme.warning
// and theme.copper both resolve to --monitor, which collapsed Loosen and
// "Wake up" onto one colour and borrowed the clinical monitor band for a step
// label — so "Loosen" read as a finding that needs watching. A step label is the
// program's own sequence, never a severity.
const STEP_COLOR: Record<string, string> = {
  Loosen: '#818CF8',
  Lengthen: '#22D3EE',
  'Wake up': '#F472B6',
  Strengthen: '#38BDF8',
  Connect: '#A78BFA',
}
const ACCENT_FALLBACK = theme.primary
const itemColor = (it?: SessionItem): string => (it ? STEP_COLOR[it.stepLabel] ?? ACCENT_FALLBACK : ACCENT_FALLBACK)

// Array v4: the HUD sits on the media scrim with no card; only the safety
// gates (pain check / stop) use the one feature glass Surface.

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
  voiceMode = 'recorded',
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

    if (voiceMode === 'browser') {
      fallbackToWebSpeech()
      return () => { cancelled = true; stopCoachVoice() }
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
  }, [state.phase, state.index, state.set, voiceMuted, redFlag, voiceMode, stopCoachVoice])

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
  const done = state.results.filter((r) => r.completed).length
  const skipped = state.results.filter((r) => r.skipped).length
  const stepStyle = { '--step': accent } as CSSProperties

  return (
    <div
      data-immersive-surface
      onPointerMove={canHide ? pokeChrome : undefined}
      onClick={canHide ? pokeChrome : undefined}
      className={styles.root}
      style={stepStyle}
    >
      {/* full-bleed demo canvas: clip loop → poster → gradient fallback */}
      <DemoCanvas item={item} active={state.phase === 'playing'} showName={active} reduceMotion={!!reduceMotion} />

      {/* top: run strip (position · step · segments) */}
      {active && (
        <div
          data-testid="workout-chrome-progress"
          aria-hidden={!chromeVisible}
          data-visible={chromeVisible ? 'true' : 'false'}
          className={[styles.top, styles.chrome, onExit ? '' : styles.topNoExit].filter(Boolean).join(' ')}
        >
          <RunStrip total={total} index={state.index} results={state.results} item={item} set={state.set} phase={state.phase} />
        </div>
      )}
      {onExit && (
        <IconButton
          icon="close-linear"
          label="Exit session"
          variant="glass"
          onClick={onExit}
          tabIndex={0}
          data-workout-chrome-controls
          className={styles.exit}
        />
      )}

      {/* voice + caption toggles */}
      {active && (
        <div
          data-testid="workout-chrome-toggles"
          data-workout-chrome-controls
          aria-hidden={!chromeVisible}
          data-visible={chromeVisible ? 'true' : 'false'}
          className={[styles.toggles, styles.chrome, onExit ? styles.togglesUnderExit : ''].filter(Boolean).join(' ')}
        >
          <button
            type="button"
            onClick={() => setVoiceMuted((m) => !m)}
            aria-label={voiceMuted ? 'Unmute coach voice' : 'Mute coach voice'}
            aria-pressed={voiceMuted}
            data-on={!voiceMuted ? 'true' : 'false'}
            tabIndex={chromeVisible ? 0 : -1}
            className={styles.toggle}
          >
            <AudioGlyph muted={voiceMuted} />
          </button>
          <button
            type="button"
            onClick={() => setCaptionsOn((c) => !c)}
            aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
            aria-pressed={captionsOn}
            tabIndex={chromeVisible ? 0 : -1}
            className={styles.toggle}
          >
            CC
          </button>
        </div>
      )}

      {/* phase content */}
      <div className={styles.stage}>
        <AnimatePresence mode="wait">
          {redFlag === 'unasked' && state.phase !== 'summary' && (
            <Fade key="redflag" reduce={!!reduceMotion}>
              <RedFlagCard
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
              <StartCard snapshot={snapshot} clientFirstName={clientFirstName} onBegin={begin} />
            </Fade>
          )}

          {redFlag === 'clear' && state.phase === 'upNext' && item && (
            <Fade key={`upnext-${state.index}`} reduce={!!reduceMotion}>
              <UpNext
                item={item}
                index={state.index}
                total={total}
                remaining={state.remainingMs / UP_NEXT_MS}
                onStart={() => dispatch({ type: 'ADVANCE' })}
              />
            </Fade>
          )}

          {redFlag === 'clear' && state.phase === 'preroll' && item && (
            <Fade key={`preroll-${state.index}`} reduce={!!reduceMotion}>
              <div className={styles.preroll}>
                <p className={`${styles.eyebrow} ${styles.eyebrowStep}`}>Get ready</p>
                {/* Largest element on screen; each digit slides in as it drops. */}
                <RollingDigits value={String(secs(state.remainingMs))} className={styles.prerollNumeral} />
                <p className={styles.prerollName}>{item.name}</p>
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
                {...(snapshot.version === 4
                  ? { prototypeDisclaimer: snapshot.disclaimer }
                  : snapshot.version === 1
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
        <div
          data-testid="workout-chrome-transport"
          data-workout-chrome-controls
          aria-hidden={!chromeVisible}
          data-visible={chromeVisible ? 'true' : 'false'}
          className={`${styles.transportWrap} ${styles.chrome}`}
        >
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

// ---- entrance/exit wrapper ------------------------------------------------
// Enters on the `glide` spring from below; exits faster and never bounces
// (DESIGN.md › Motion rule 3). Reduced motion: opacity only.
function Fade({ children, reduce }: { children: React.ReactNode; reduce: boolean }) {
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, transition: spring.glide }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, transition: { duration: 0.14, ease: 'easeOut' } }}
      transition={reduce ? { duration: 0.12 } : spring.glide}
      className={styles.phase}
    >
      {children}
    </motion.div>
  )
}

/**
 * A ticking readout as an odometer: each character is its own SlotNumber keyed
 * by position + glyph, so only the digit that changed slides in (a full re-key
 * would re-roll every digit each second). One accessible text for the whole.
 */
function RollingDigits({ value, className }: { value: string; className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {Array.from(value).map((ch, i) => (
          <SlotNumber key={`${value.length}-${i}-${ch}`} value={ch} />
        ))}
      </span>
    </span>
  )
}

// ---- full-bleed demo placeholder ----------------------------------------
// Memoized: the parent re-renders on every 200ms TICK, but these props only
// change on item/phase transitions — skip the reconciliation on ticks. (results
// keeps a stable array identity across ticks; the reducer only replaces it on a
// real transition.)
const DemoCanvas = memo(function DemoCanvas({ item, active, showName = true, reduceMotion }: { item?: SessionItem; active: boolean; showName?: boolean; reduceMotion: boolean }) {
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
      {/* underlay always renders — the video sits above it, so a slow clip
          fades in over a soft aura in the current step's colour, not black */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(120% 60% at 50% 38%, color-mix(in oklab, var(--step) ${active && !reduceMotion ? 16 : 10}%, transparent) 0%, transparent 62%), linear-gradient(180deg, ${theme.background} 0%, ${theme.backgroundSunken} 100%)`,
          transition: 'background 480ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      />
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
      {showGradient && item && showName && (
        // No clip: the movement's name, set huge and faint at the foot of the
        // frame, stands in for the picture without competing with the HUD.
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 116px)',
            padding: '0 20px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            color: colorMix(theme.textPrimary, 5),
            textAlign: 'center',
            font: 'var(--t-hero)',
            fontSize: 'clamp(3rem, 15vw, 5rem)',
            letterSpacing: '-0.055em',
            lineHeight: 0.9,
            userSelect: 'none',
          }}
        >
          {item.name}
        </div>
      )}
    </div>
  )
})

// ---- run strip: position, step, one segment per movement -------------------
const pad2 = (n: number) => String(n).padStart(2, '0')

const RunStrip = memo(function RunStrip({ total, index, results, item, set, phase }: { total: number; index: number; results: { completed: boolean; skipped: boolean }[]; item?: SessionItem; set: number; phase: PlayerState['phase'] }) {
  const sets = item?.timing.sets ?? 1
  // The current segment fills by sets finished, so the strip moves inside a movement too.
  const currentFill = Math.max(0.06, Math.min(1, (set - 1 + (phase === 'resting' ? 1 : 0)) / sets))
  return (
    <>
      <p className={styles.count}>
        <span><span className={styles.countNow}>{pad2(Math.min(index + 1, total))}</span> / {pad2(total)}</span>
        {item ? (
          <span className={styles.stepTag}>
            <span className={styles.stepDot} aria-hidden="true" />
            {item.stepLabel}
          </span>
        ) : null}
      </p>
      <div className={styles.segments}>
        {Array.from({ length: total }).map((_, i) => {
          const r = results[i]
          const state = r?.skipped ? 'skipped' : r?.completed || i < index ? 'done' : i === index ? 'current' : 'todo'
          const fill = state === 'todo' ? 0 : state === 'current' ? currentFill : 1
          return (
            <div key={i} className={styles.seg} data-state={state}>
              <div className={styles.segFill} style={{ '--fill': fill } as CSSProperties} />
            </div>
          )
        })}
      </div>
    </>
  )
})

// ---- start ------------------------------------------------------------------
function StartCard({ snapshot, clientFirstName, onBegin }: { snapshot: SessionSnapshot; clientFirstName?: string | null; onBegin: () => void }) {
  const mins = Math.max(1, Math.round(snapshot.estimatedDurationSec / 60))
  const count = snapshot.items.length
  const steps = Array.from(new Set(snapshot.items.map((it) => it.stepLabel)))
  return (
    <div className={styles.start}>
      <div className={styles.startHead}>
        {clientFirstName && <p className={styles.greeting}>Hi {clientFirstName}</p>}
        <h1 className={styles.startTitle}>Your guided session</h1>
      </div>

      <p className="sr-only">{count} movements · about {mins} min</p>
      <div className={styles.stats} aria-hidden="true">
        <div className={styles.stat}>
          <SlotNumber value={count} className={styles.statValue} />
          <span className={styles.eyebrow}>movements</span>
        </div>
        <div className={styles.stat}>
          <SlotNumber value={mins} className={styles.statValue} delay={120} />
          <span className={styles.eyebrow}>about · min</span>
        </div>
      </div>

      {count > 0 ? (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'center', width: '100%' }} aria-hidden="true">
          <div className={styles.arc}>
            {snapshot.items.map((it, i) => (
              <span
                key={`${it.slug}-${i}`}
                className={styles.arcTick}
                style={{ '--step': itemColor(it), animationDelay: `${Math.min(i, 8) * 30}ms` } as CSSProperties}
              />
            ))}
          </div>
          <ul className={styles.arcLegend}>
            {steps.map((label) => (
              <li key={label} style={{ '--step': STEP_COLOR[label] ?? ACCENT_FALLBACK } as CSSProperties}>
                <span className={styles.stepDot} />
                {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <WorkoutLegalNotice
        {...(snapshot.version === 4
          ? { prototypeDisclaimer: snapshot.disclaimer }
          : snapshot.version === 1
            ? { legacyDisclaimer: snapshot.disclaimer }
            : { legalNotice: snapshot.legalNotice })}
      />
      <div className={`${styles.primaryWrap} ${styles.dock}`}>
        <Button onClick={onBegin} variant="primary" size="lg" block>
          Begin session
        </Button>
      </div>
    </div>
  )
}

// ---- up next ------------------------------------------------------------
function UpNext({ item, index, total, remaining, onStart }: { item: SessionItem; index: number; total: number; remaining: number; onStart: () => void }) {
  const dose = timingLabel(item).split(' · ')
  return (
    <div className={styles.upNext}>
      <div className={styles.upNextHead}>
        <p className={styles.eyebrow}>
          Up next · {index + 1} of {total}
        </p>
        <p className={styles.eyebrow}>
          <span className={styles.stepTag}>
            <span className={styles.stepDot} aria-hidden="true" />
            {item.stepLabel}
          </span>
        </p>
        <h2 className={styles.upNextTitle}>{item.name}</h2>
        <p className={styles.dose}>
          {dose.map((part) => <span key={part}>{part}</span>)}
        </p>
        <p className={styles.focus}>{item.priorityLabel}</p>
      </div>
      {item.steps && item.steps.length > 0 && (
        <ol className={styles.steps}>
          {item.steps.slice(0, 5).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <div className={styles.primaryWrap} style={{ margin: '0 auto' }}>
        <Button onClick={onStart} variant="primary" size="lg" block>
          Start now →
        </Button>
        {/* Up next starts by itself: the hairline drains toward the auto-start. */}
        <div className={styles.autoBar} aria-hidden="true">
          <div className={styles.autoBarFill} style={{ '--fill': Math.max(0, Math.min(1, remaining)) } as CSSProperties} />
        </div>
      </div>
    </div>
  )
}

// ---- playing / resting HUD ---------------------------------------------
function PlayingHud({ state, item, accent, captionText, onNext }: { state: PlayerState; item: SessionItem; accent: string; captionText: string; onNext: () => void }) {
  const isRest = state.phase === 'resting'
  const isHold = item.timing.kind === 'hold'
  const repsPerSet = item.timing.kind === 'reps' ? item.timing.repsPerSet : 0
  const sets = item.timing.sets
  const totalMs = segmentTotalMs(state)
  const progress = isRest || isHold ? state.remainingMs / totalMs : 1

  return (
    <div className={styles.hud} data-rest={isRest ? 'true' : 'false'}>
      <div className={styles.hudHead}>
        <p className={`${styles.eyebrow} ${isRest ? '' : styles.eyebrowStep}`}>
          {isRest ? `Rest · then set ${Math.min(state.set + 1, sets)} of ${sets}` : `Set ${state.set} of ${sets}`}
        </p>
        {isRest ? (
          <p className={styles.hudName}>{item.name}</p>
        ) : (
          <h2 className={styles.hudName}>{item.name}</h2>
        )}
      </div>

      {isRest || isHold ? (
        // The seconds readout is the largest thing on screen — legible from
        // arm's length — and tabular so a counting-down timer never reflows.
        <CountdownRing
          key={`${state.phase}-${state.index}-${state.set}`}
          progress={progress}
          color={isRest ? 'var(--ink-3)' : accent}
          dimmed={isRest}
        >
          <RollingDigits
            value={String(secs(state.remainingMs))}
            className={`${styles.numeral} ${isRest ? styles.numeralRest : ''}`}
          />
          <p className={styles.unit}>{isRest ? 'seconds · rest' : 'seconds · hold'}</p>
        </CountdownRing>
      ) : (
        <div className={styles.target}>
          <p className={styles.eyebrow}>Target</p>
          <span className={styles.numeral}>
            <span className={styles.numeralPrefix} aria-hidden="true">×</span>
            <SlotNumber value={repsPerSet} />
          </span>
          <p className={styles.unit}>controlled reps</p>
        </div>
      )}

      {sets > 1 ? (
        <div className={styles.setBeads} aria-hidden="true">
          {Array.from({ length: sets }).map((_, i) => (
            <span
              key={i}
              className={styles.setBead}
              data-state={i < state.set - 1 || (isRest && i === state.set - 1) ? 'done' : i === state.set - 1 ? 'now' : undefined}
            />
          ))}
        </div>
      ) : null}

      {/* caption (mirrors the voice cue) */}
      <p aria-live="polite" className={styles.caption}>
        {captionText}
      </p>

      {!isRest && !isHold && (
        // The screen's one primary action for this phase — marking the set
        // done. haptic="success" for "haptic on set done".
        <div className={styles.primaryWrap}>
          <Button onClick={onNext} variant="primary" size="lg" block haptic="success">
            Done, next →
          </Button>
        </div>
      )}
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" />
    </svg>
  )
}

function Transport({ paused, onBack, onPauseToggle, onSkip, atStart, isVisible }: { paused: boolean; onBack: () => void; onPauseToggle: () => void; onSkip: () => void; atStart: boolean; isVisible: boolean }) {
  // A media transport in a glass capsule. Back keeps a native `disabled`: BACK
  // at index 0 is not a no-op (playerMachine resets the current item's
  // result), so it must truly be unavailable there. Pause morphs disc →
  // squircle while paused, so the state reads from the shape as well.
  const tab = isVisible ? 0 : -1
  return (
    <div className={styles.transport}>
      <button type="button" onClick={() => { haptic('tap'); onBack() }} aria-label="Back" disabled={atStart} tabIndex={tab} className={styles.tBtn}>
        <Icon name="skip-previous-linear" size={22} />
        <span className={styles.tLabel} aria-hidden="true">Back</span>
      </button>
      <button
        type="button"
        onClick={() => { haptic('tap'); onPauseToggle() }}
        tabIndex={tab}
        className={styles.tMain}
        data-paused={paused ? 'true' : 'false'}
      >
        {paused ? <PlayGlyph /> : <Icon name="pause-linear" size={26} />}
        <span className="sr-only">{paused ? 'Resume' : 'Pause'}</span>
      </button>
      <button type="button" onClick={() => { haptic('tap'); onSkip() }} tabIndex={tab} className={styles.tBtn}>
        <Icon name="skip-next-linear" size={22} />
        <span className={styles.tLabel}>Skip</span>
      </button>
    </div>
  )
}

// ---- red-flag pre-session safety screen ---------------------------------
function RedFlagCard({ onClear, onStop }: { onClear: () => void; onStop: () => void }) {
  return (
    <Surface tier="feature">
      <div className={styles.gate}>
        <p className={styles.eyebrow}>Pain check</p>
        <h2 className={styles.gateTitle}>
          Before you start — are you feeling any sharp or worsening pain right now?
        </h2>
        <div className={styles.gateActions}>
          <Button onClick={onClear} data-testid="red-flag-no" variant="primary" size="lg" block>
            No, I feel okay
          </Button>
          <Button onClick={onStop} data-testid="red-flag-yes" variant="secondary" size="lg" block>
            Yes
          </Button>
        </div>
      </div>
    </Surface>
  )
}

// ---- stop card (shown when user reports pain) ----------------------------
function StopCard({ onDismiss }: { onDismiss?: () => void }) {
  return (
    // data-testid lives on this wrapper — Surface doesn't forward arbitrary
    // props, so the e2e hook has to sit outside it.
    <div data-testid="stop-card">
      <Surface tier="feature">
        <div className={styles.gate}>
          <h2 className={styles.gateTitle}>Let&apos;s pause here.</h2>
          <p className={styles.gateBody}>
            Sharp pain is worth checking with a movement professional before continuing.
          </p>
          <div className={styles.gateActions}>
            <Button onClick={onDismiss} data-testid="stop-card-dismiss" variant="secondary" size="lg" block>
              End session
            </Button>
          </div>
        </div>
      </Surface>
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
