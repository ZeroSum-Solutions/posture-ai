'use client'

import { useEffect, useState } from 'react'
import { TrainingPreviousPerformanceV1Schema, type TrainingPreviousPerformanceV1 } from '@/lib/training/contracts/previous-performance'
import type { EquipmentLoadBasis } from '@/lib/training/equipment'
import { Button } from '@/components/ui'
import styles from './StrengthProgramBuilder.module.css'

type Props = { sessionId: string; exerciseInstanceId: string }
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; result: TrainingPreviousPerformanceV1['result'] }
const basisLabels: Record<EquipmentLoadBasis, string> = {
  barbell_total: 'total on the bar',
  dumbbell_per_hand: 'per dumbbell',
  dumbbell_single_implement: 'one dumbbell total',
  machine_stack: 'machine stack',
  bodyweight_external: 'added external load',
  machine_assistance: 'assistance provided by the machine',
}

function PreviousPerformance({ sessionId, exerciseInstanceId }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void (async () => {
      try {
        const response = await fetch(`/api/training/sessions/${encodeURIComponent(sessionId)}/exercises/${encodeURIComponent(exerciseInstanceId)}/previous-performance`, {
          cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) throw new Error('Previous performance unavailable')
        const parsed = TrainingPreviousPerformanceV1Schema.safeParse(await response.json())
        if (!parsed.success || parsed.data.request.sessionId !== sessionId || parsed.data.request.exerciseInstanceId !== exerciseInstanceId) throw new Error('Previous performance mismatch')
        if (active) setState({ kind: 'ready', result: parsed.data.result })
      } catch {
        if (active) setState({ kind: 'error' })
      }
    })()
    return () => { active = false; controller.abort() }
  }, [sessionId, exerciseInstanceId, attempt])

  const result = state.kind === 'ready' ? state.result : null
  return <aside className={styles.pendingPanel} aria-label="Previous comparable session">
    <h4 className="t-headline">Previous comparable session</h4>
    {state.kind === 'loading' ? <p role="status">Loading saved performance…</p> : null}
    {state.kind === 'error' || result?.kind === 'unavailable' ? <>
      <p>Comparable saved performance is unavailable. Use your prescribed targets below.</p>
      <Button variant="secondary" size="sm" onClick={() => { setState({ kind: 'loading' }); setAttempt(value => value + 1) }}>Retry previous performance</Button>
    </> : null}
    {result?.kind === 'none' ? <p>No comparable saved session yet.</p> : null}
    {result?.kind === 'available' ? <>
      <p>Session on <time dateTime={result.source.scheduledLocalDate}>{result.source.scheduledLocalDate}</time></p>
      {result.source.executionContext.kind === 'synthetic_simulation' ? <p>Practice data · Simulation</p> : null}
      <ul>{result.sets.map(set => <li key={set.ordinal}>
        Set {set.ordinal}: {set.load.quantity.entered.value} {set.load.quantity.entered.unit} · {basisLabels[set.load.basis]} · {set.reps} reps · {set.rir === 'unknown' ? 'RIR not recorded' : `RIR ${set.rir === '6_plus' ? '6+' : set.rir}`}{set.side === 'left' || set.side === 'right' ? ` · ${set.side} side` : ''}
      </li>)}</ul>
      <p>Saved working sets from a matching exercise setup. These are past results, not a new target.</p>
    </> : null}
  </aside>
}

export default function TrainingPreviousPerformance(props: Props) {
  return <PreviousPerformance key={`${props.sessionId}:${props.exerciseInstanceId}`} {...props} />
}
