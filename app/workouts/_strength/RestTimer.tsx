'use client'

import { useEffect, useRef, useState } from 'react'
import { CountdownRing } from '@/app/workouts/_player/CountdownRing'
import styles from './StrengthProgramBuilder.module.css'

type TimerState = 'idle' | 'running' | 'paused' | 'finished' | 'skipped'

function formattedTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function spokenTime(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const parts = []
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`)
  return parts.join(' ')
}

function nextAction(state: TimerState): string {
  if (state === 'running') return 'Next: begin the next set when the timer reaches zero.'
  if (state === 'paused') return 'Rest paused. Resume when ready.'
  if (state === 'finished') return 'Rest complete. Begin the next set when ready.'
  if (state === 'skipped') return 'Rest skipped. Begin the next set when ready.'
  return 'Start when you are ready to rest between sets.'
}

export default function RestTimer({ durationSeconds, exerciseLabel }: {
  durationSeconds: number
  exerciseLabel: string
}) {
  const durationMs = durationSeconds * 1_000
  const [remainingMs, setRemainingMs] = useState(durationMs)
  const [state, setState] = useState<TimerState>('idle')
  const deadlineRef = useRef<number | null>(null)

  useEffect(() => {
    if (state !== 'running') return
    const updateFromClock = () => {
      if (deadlineRef.current === null) return
      const nextRemaining = Math.max(0, deadlineRef.current - performance.now())
      setRemainingMs(nextRemaining)
      if (nextRemaining === 0) {
        deadlineRef.current = null
        setState('finished')
      }
    }
    const interval = window.setInterval(updateFromClock, 250)
    document.addEventListener('visibilitychange', updateFromClock)
    window.addEventListener('focus', updateFromClock)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', updateFromClock)
      window.removeEventListener('focus', updateFromClock)
    }
  }, [state])

  function start() {
    const nextRemaining = state === 'paused' ? remainingMs : durationMs
    setRemainingMs(nextRemaining)
    deadlineRef.current = performance.now() + nextRemaining
    setState('running')
  }

  function pause() {
    if (deadlineRef.current === null) return
    const nextRemaining = Math.max(0, deadlineRef.current - performance.now())
    deadlineRef.current = null
    setRemainingMs(nextRemaining)
    setState(nextRemaining === 0 ? 'finished' : 'paused')
  }

  function reset() {
    deadlineRef.current = null
    setRemainingMs(durationMs)
    setState('idle')
  }

  function skip() {
    deadlineRef.current = null
    setRemainingMs(0)
    setState('skipped')
  }

  const progress = durationMs === 0 ? 0 : remainingMs / durationMs
  const time = formattedTime(remainingMs)
  const timeLabel = spokenTime(remainingMs)

  return <section className={styles.restTimer} aria-label={`${exerciseLabel} rest timer`}>
    <CountdownRing progress={progress} color="var(--text-secondary)" size={152} strokeWidth={8} dimmed={state !== 'running'}>
      <output className="t-readout-xl" role="timer" aria-label={`Rest time remaining ${timeLabel}`}>{time}</output>
      <span className="t-overline">rest</span>
    </CountdownRing>
    <div className={styles.restTimerDetails}>
      <div>
        <p className="t-overline">Optional rest timer</p>
        <p className="t-body">{nextAction(state)}</p>
      </div>
      <div className={styles.restTimerControls}>
        {state === 'running'
          ? <button type="button" className="a-primary" onClick={pause}>Pause rest timer</button>
          : <button type="button" className="a-primary" onClick={start}>{state === 'paused' ? 'Resume rest timer' : 'Start rest timer'}</button>}
        <button type="button" className="a-secondary" onClick={reset} disabled={state === 'idle'}>Reset rest timer</button>
        <button type="button" className="a-secondary" onClick={skip} disabled={state === 'finished' || state === 'skipped'}>Skip rest timer</button>
      </div>
    </div>
  </section>
}
