'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AcceptedTrainingBuild, CreatedTrainingProgram, StartingTargetsSelection, TrainingBuildProjection } from './StrengthBuilder.gateway'
import TrainingBuildExplanationPanel from './TrainingBuildExplanationPanel'
import styles from './StrengthProgramBuilder.module.css'

type Calibration = TrainingBuildProjection['calibrations'][number]['calibration']
type Draft = Extract<TrainingBuildProjection['result'], { kind: 'draft_program' }>
type ConditioningBout = Draft['weeks'][number]['conditioningBouts'][number]
type ProgramPhase = Draft['weeks'][number]['phase']

const phaseLabels: Record<ProgramPhase, string> = {
  calibration: 'Familiarization',
  build: 'Progressive practice',
  review_adjust: 'Review and adjust',
  review: 'Next-cycle review',
}

function optionLabel(option: Calibration['options'][number]): string {
  const load = `${option.quantity.entered.value} ${option.quantity.entered.unit}`
  if (option.basis === 'dumbbell_single_implement') return `${load} · one dumbbell total`
  if (option.basis === 'dumbbell_per_hand') return `${load} per hand · two dumbbells`
  if (option.basis === 'barbell_total') return `${load} total on the bar`
  if (option.basis === 'bodyweight_external') return `${load} · ${option.quantity.canonicalKg === '0' ? 'bodyweight only' : 'added externally to bodyweight'}`
  if (option.basis === 'machine_assistance') return `${load} · assistance from the machine`
  return `${load} on the machine stack`
}

function dateLabel(weekday: string, localDate: string): string {
  const [, monthValue, dayValue] = localDate.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthValue - 1] ?? localDate
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${month} ${dayValue}`
}

function resultMessage(result: Exclude<TrainingBuildProjection['result'], { kind: 'draft_program' }>): string {
  if (result.kind === 'schedule_adjustment_required') return 'Choose one of the nonconsecutive schedule alternatives before building.'
  if (result.kind === 'time_budget_insufficient') return `The program needs more than ${result.requestedBudgetMinutes} minutes per session.`
  if (result.kind === 'needs_template_adjustment') return 'The current equipment and practice catalog cannot cover every required movement.'
  return 'Choose a valid local cycle start date.'
}

export default function PracticeDraftPanel({ projection, sessionHrefBase = '/workouts', onAcceptTargets, onPublishDraft }: {
  projection: TrainingBuildProjection
  sessionHrefBase?: '/workouts' | '/train'
  onAcceptTargets?: (input: StartingTargetsSelection) => Promise<AcceptedTrainingBuild>
  onPublishDraft?: (draftId: string) => Promise<CreatedTrainingProgram>
}) {
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [conditioningDuration, setConditioningDuration] = useState<Record<string, number>>({})
  const [state, setState] = useState<'idle' | 'accepting' | 'publishing' | 'publish_failed' | 'accepted'>('idle')
  const [acceptedDraftId, setAcceptedDraftId] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedTrainingProgram | null>(null)
  const [error, setError] = useState('')
  const { result } = projection

  const conditioningSlots = useMemo(() => {
    if (result.kind !== 'draft_program') return []
    const slots = new Map<ConditioningBout['weekday'], ConditioningBout & { count: number }>()
    for (const week of result.weeks) {
      for (const bout of week.conditioningBouts) {
        const current = slots.get(bout.weekday)
        slots.set(bout.weekday, current ? { ...current, count: current.count + 1 } : { ...bout, count: 1 })
      }
    }
    return [...slots.values()]
  }, [result])

  if (result.kind !== 'draft_program') return <div className={styles.draftNotice} role="alert">{resultMessage(result)}</div>

  const canAccept = projection.calibrations.length > 0
    && projection.calibrations.every(item => item.calibration.options.length > 0)
    && conditioningSlots.length > 0

  async function acceptTargets() {
    if (!onAcceptTargets || !onPublishDraft) return
    let draftId = acceptedDraftId
    setState(draftId ? 'publishing' : 'accepting')
    setError('')
    try {
      if (!draftId) {
        const accepted = await onAcceptTargets({
          loadChoices: projection.calibrations.map(({ calibration }) => ({
            exerciseInstanceId: calibration.exerciseInstanceId,
            optionIndex: selected[calibration.exerciseInstanceId] ?? 0,
          })),
          conditioningChoices: conditioningSlots.map(slot => ({
            boutId: slot.boutId,
            acceptedDurationSeconds: conditioningDuration[slot.boutId] ?? slot.durationOfferSeconds,
          })),
        })
        draftId = accepted.draftId
        setAcceptedDraftId(draftId)
        setState('publishing')
      }
      const program = await onPublishDraft(draftId)
      setCreated(program)
      setState('accepted')
    } catch {
      if (draftId) {
        setState('publish_failed')
        setError('Starting targets were accepted, but the program was not published. Retry publishing this accepted draft.')
      } else {
        setState('idle')
        setError('Starting targets were not accepted. Review the selections and try again.')
      }
    }
  }

  const cycleLengthWeeks = result.cycleLengthWeeks
  const isPractice = result.executionContext.kind === 'synthetic_simulation'
  const draftLabel = isPractice ? 'Practice data · Simulation' : 'Program draft'
  const loadCount = projection.calibrations.length
  const profileRevision = Number(result.profileRevisionId)
  const explanationIdentity = [
    projection.buildId,
    result.subjectId,
    result.profileRevisionId,
    result.programRevisionId,
    result.catalogVersion,
    JSON.stringify(result.catalogOrigin),
    JSON.stringify(result.executionContext),
  ].join('|')

  return <section className={styles.practiceDraft} aria-labelledby="practice-draft-heading">
    <div className={styles.sectionHeading}>
      <div><p className="t-overline">{draftLabel}</p><h3 id="practice-draft-heading" className="t-title-2">{cycleLengthWeeks}-week draft</h3></div>
      <span className="t-footnote">{cycleLengthWeeks} weeks · {result.scheduleKind.replace('_', ' ')}</span>
    </div>
    <p className="t-body">Review {loadCount} starting {loadCount === 1 ? 'load' : 'loads'} and the weekly conditioning rhythm before creating the program.</p>
    {projection.buildId && Number.isSafeInteger(profileRevision) && profileRevision > 0
      ? <TrainingBuildExplanationPanel
          key={explanationIdentity}
          binding={{ buildId: projection.buildId, subjectId: result.subjectId, profileRevision }}
        />
      : null}
    <div className={styles.scheduleStrip} aria-label={`${cycleLengthWeeks}-week schedule preview`}>
      {result.weeks.map(week => <span key={week.week}>
        <strong>W{week.week}</strong>
        <em className={styles.phaseLabel}>{phaseLabels[week.phase]}</em>
        <small>{week.strengthSessions.length} strength · {week.conditioningBouts.length} conditioning</small>
      </span>)}
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.sectionHeading}>
      <div><p className="t-overline">Starting loads</p><h3 className="t-title-2">Choose one target per exercise</h3></div>
      <span className="t-footnote">Applied to matching prescribed sessions</span>
    </div>
    <div className={styles.calibrationGrid}>
      {projection.calibrations.map(({ exerciseLabel, calibration, exposureType }) => <article key={calibration.exerciseInstanceId} className={styles.calibrationCard}>
        <div><p className="t-overline">{calibration.loadBasis.replaceAll('_', ' ')}</p><h4>{exerciseLabel}</h4></div>
        {exposureType === 'heavy' || exposureType === 'volume' ? <p className="t-footnote">{exposureType === 'heavy' ? 'Heavy session' : 'Volume session'} · separate starting load and progression</p> : null}
        {calibration.options.length > 0 ? <label>Starting load
          <select
            className="a-input"
            value={selected[calibration.exerciseInstanceId] ?? 0}
            disabled={state !== 'idle'}
            onChange={event => setSelected(current => ({ ...current, [calibration.exerciseInstanceId]: Number(event.target.value) }))}
          >
            {calibration.options.map((option, index) => <option key={`${option.equipmentId}:${option.quantity.canonicalKg}`} value={index}>{optionLabel(option)}</option>)}
          </select>
        </label> : <p className="t-footnote">No exact saved load is available for this practice range.</p>}
      </article>)}
    </div>
    <div className={styles.sectionHeading}>
      <div><p className="t-overline">Conditioning</p><h3 className="t-title-2">Choose each weekly starting duration</h3></div>
      <span className="t-footnote">{conditioningSlots.length} weekly slots</span>
    </div>
    <div className={styles.conditioningGrid}>
      {conditioningSlots.map(slot => <article key={slot.boutId} className={styles.calibrationCard}>
        <div><p className="t-overline">{slot.count} bouts</p><h4>{dateLabel(slot.weekday, slot.scheduledLocalDate)}</h4></div>
        <p className="t-body">{slot.effortCue}</p>
        <label>Duration in minutes
          <input
            className="a-input"
            type="number"
            min={slot.allowedDurationSeconds.minimum / 60}
            max={slot.allowedDurationSeconds.maximum / 60}
            step="1"
            value={(conditioningDuration[slot.boutId] ?? slot.durationOfferSeconds) / 60}
            disabled={state !== 'idle'}
            onChange={event => setConditioningDuration(current => ({ ...current, [slot.boutId]: Number(event.target.value) * 60 }))}
          />
        </label>
      </article>)}
    </div>
    <div className={styles.targetAcceptance}>
      <p className="t-body">No target is inferred from posture, body size, or a recalled load.</p>
      {state === 'accepted'
        ? <div className={styles.createdProgram}>
            <p role="status" className={styles.accepted}>Starting targets accepted and program created.</p>
            {created?.firstStrengthSessionId ? <Link className="a-primary" href={`${sessionHrefBase}?training_session_id=${encodeURIComponent(created.firstStrengthSessionId)}`}>Open first strength session</Link> : null}
            {created?.firstConditioningSessionId ? <Link className="a-secondary" href={`${sessionHrefBase}?training_session_id=${encodeURIComponent(created.firstConditioningSessionId)}`}>Open first conditioning session</Link> : null}
          </div>
        : <button type="button" className="a-primary" disabled={!canAccept || !onAcceptTargets || !onPublishDraft || state === 'accepting' || state === 'publishing'} onClick={() => void acceptTargets()}>{state === 'accepting' ? 'Accepting starting targets…' : state === 'publishing' ? 'Publishing program…' : state === 'publish_failed' ? 'Retry publishing accepted draft' : 'Use these starting targets'}</button>}
    </div>
  </section>
}
