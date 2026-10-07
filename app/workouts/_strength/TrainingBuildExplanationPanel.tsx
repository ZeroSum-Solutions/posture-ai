'use client'

import { useEffect, useRef, useState } from 'react'
import {
  TrainingBuildExplanationV1Schema,
  type TrainingBuildExplanationBindingV1,
  type TrainingBuildExplanationV1,
} from '@/lib/training/explanation/contracts'
import styles from './StrengthProgramBuilder.module.css'

type ExplanationLoader = (
  buildId: string,
  signal: AbortSignal,
) => Promise<unknown>

async function loadTrainingBuildExplanation(buildId: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(
    `/api/training/programs/builds/${encodeURIComponent(buildId)}/explanation`,
    { method: 'POST', headers: { Accept: 'application/json' }, signal },
  )
  if (!response.ok) throw new Error('training_build_explanation_unavailable')
  return response.json()
}

function hasExactBinding(
  explanation: TrainingBuildExplanationV1,
  expected: TrainingBuildExplanationBindingV1,
) {
  return explanation.binding.buildId === expected.buildId
    && explanation.binding.subjectId === expected.subjectId
    && explanation.binding.profileRevision === expected.profileRevision
}

export default function TrainingBuildExplanationPanel({
  binding,
  loadExplanation = loadTrainingBuildExplanation,
}: {
  binding: TrainingBuildExplanationBindingV1
  loadExplanation?: ExplanationLoader
}) {
  const bindingKey = `${binding.buildId}|${binding.subjectId}|${binding.profileRevision}`
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [stateBindingKey, setStateBindingKey] = useState(bindingKey)
  const [explanation, setExplanation] = useState<TrainingBuildExplanationV1 | null>(null)
  const requestSequence = useRef(0)
  const activeController = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      requestSequence.current += 1
      activeController.current?.abort()
      activeController.current = null
    }
  }, [binding.buildId, binding.profileRevision, binding.subjectId])

  const verifiedExplanation = explanation && hasExactBinding(explanation, binding)
    ? explanation
    : null
  const displayState = stateBindingKey !== bindingKey || (state === 'ready' && !verifiedExplanation)
    ? 'idle'
    : state

  async function explainDraft() {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    activeController.current?.abort()
    const controller = new AbortController()
    activeController.current = controller
    setStateBindingKey(bindingKey)
    setExplanation(null)
    setState('loading')
    try {
      const parsed = TrainingBuildExplanationV1Schema.safeParse(
        await loadExplanation(binding.buildId, controller.signal),
      )
      if (sequence !== requestSequence.current || controller.signal.aborted) return
      if (!parsed.success || !hasExactBinding(parsed.data, binding)) {
        setState('unavailable')
        return
      }
      setExplanation(parsed.data)
      setState('ready')
    } catch {
      if (sequence !== requestSequence.current || controller.signal.aborted) return
      setState('unavailable')
    } finally {
      if (activeController.current === controller) activeController.current = null
    }
  }

  return <section className={styles.calibrationCard} aria-labelledby="training-build-explanation-heading">
    <div>
      <p className="t-overline">Draft explanation</p>
      <h4 id="training-build-explanation-heading">Why this draft looks this way</h4>
    </div>
    {displayState === 'ready' && verifiedExplanation
      ? <>
          <p className="t-footnote">These facts describe the current draft. They do not change its targets.</p>
          <ul>
            {verifiedExplanation.facts.map(fact => <li key={fact.factId}>{fact.text}</li>)}
          </ul>
        </>
      : <p className="t-body">See the schedule, exercise, rest, and starting-choice facts already used by this draft.</p>}
    {displayState === 'unavailable'
      ? <p role="alert" className={styles.error}>The explanation could not be verified for this draft. Refresh the draft and try again.</p>
      : null}
    <button
      type="button"
      className="a-secondary"
      disabled={displayState === 'loading'}
      onClick={() => void explainDraft()}
    >{displayState === 'loading' ? 'Explaining draft…' : displayState === 'ready' ? 'Refresh explanation' : 'Explain this draft'}</button>
  </section>
}
