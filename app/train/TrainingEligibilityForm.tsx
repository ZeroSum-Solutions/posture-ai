'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Surface } from '@/components/array/Surface'
import {
  EligibilityAnswersV1Schema,
  type EligibilityAnswersV1,
} from '@/lib/training/contracts/eligibility'
import styles from '@/app/workouts/_strength/StrengthProgramBuilder.module.css'

const PROJECTION_VERSION = 'training-eligibility-answers-projection.v1'
const RECEIPT_VERSION = 'training-eligibility-answer-receipt.v1'

type EligibilityAnswersInput = Omit<EligibilityAnswersV1,
  'schemaVersion' | 'questionnaireSourceVersion' | 'submittedAt' | 'origin'>

type Projection = {
  subjectId: string
  revision: number
  answers: EligibilityAnswersInput
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projection: Projection }

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'conflict' }
  | { status: 'reloading' }
  | { status: 'error'; message: string }

const UNKNOWN_ANSWERS: EligibilityAnswersInput = {
  adultScope: 'unknown',
  currentActivity: 'unknown',
  knownConditions: {
    cardiovascular: 'unknown',
    metabolic: 'unknown',
    renal: 'unknown',
  },
  relevantSignsOrSymptoms: 'unknown',
  desiredIntensity: 'unknown',
  answerCertainty: 'uncertain',
  pregnancyPostpartumContext: 'unknown',
  requestedProgrammingScope: 'unknown',
}

function toInput(answers: EligibilityAnswersV1): EligibilityAnswersInput {
  return {
    adultScope: answers.adultScope,
    currentActivity: answers.currentActivity,
    knownConditions: { ...answers.knownConditions },
    relevantSignsOrSymptoms: answers.relevantSignsOrSymptoms,
    desiredIntensity: answers.desiredIntensity,
    answerCertainty: answers.answerCertainty,
    pregnancyPostpartumContext: answers.pregnancyPostpartumContext,
    requestedProgrammingScope: answers.requestedProgrammingScope,
  }
}

function parseProjection(value: unknown): Projection | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== PROJECTION_VERSION || typeof record.subjectId !== 'string' || !record.subjectId) return null
  if (record.current === null) {
    return { subjectId: record.subjectId, revision: 0, answers: structuredClone(UNKNOWN_ANSWERS) }
  }
  if (!record.current || typeof record.current !== 'object') return null
  const current = record.current as Record<string, unknown>
  if (!Number.isInteger(current.revision) || (current.revision as number) < 1) return null
  const answers = EligibilityAnswersV1Schema.safeParse(current.answers)
  if (!answers.success) return null
  return {
    subjectId: record.subjectId,
    revision: current.revision as number,
    answers: toInput(answers.data),
  }
}

async function requestProjection(signal?: AbortSignal): Promise<Projection> {
  const response = await fetch('/api/training/eligibility/answers', { cache: 'no-store', signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error('Your saved answers could not be loaded.')
  const projection = parseProjection(body)
  if (!projection) throw new Error('The saved answer response was invalid.')
  return projection
}

function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return <label>{label}<select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label>
}

const YesNoUnknownOptions = () => <>
  <option value="unknown">Not sure</option>
  <option value="no">No</option>
  <option value="yes">Yes</option>
</>

export default function TrainingEligibilityForm() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [answers, setAnswers] = useState<EligibilityAnswersInput>(() => structuredClone(UNKNOWN_ANSWERS))
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })

  function applyProjection(projection: Projection) {
    setLoadState({ status: 'ready', projection })
    setAnswers(structuredClone(projection.answers))
    setSaveState({ status: 'idle' })
  }

  useEffect(() => {
    const controller = new AbortController()
    void requestProjection(controller.signal)
      .then(applyProjection)
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setLoadState({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Your saved answers could not be loaded.',
        })
      })
    return () => controller.abort()
  }, [])

  async function retryLoad() {
    setLoadState({ status: 'loading' })
    try {
      applyProjection(await requestProjection())
    } catch (cause) {
      setLoadState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Your saved answers could not be loaded.',
      })
    }
  }

  async function reloadSavedAnswers() {
    setSaveState({ status: 'reloading' })
    try {
      applyProjection(await requestProjection())
    } catch (cause) {
      setSaveState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Your saved answers could not be reloaded.',
      })
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loadState.status !== 'ready' || saveState.status === 'saving' || saveState.status === 'conflict') return
    setSaveState({ status: 'saving' })
    try {
      const response = await fetch('/api/training/eligibility/answers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: loadState.projection.revision, answers }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (response.status === 409 && body && typeof body === 'object'
        && (body as Record<string, unknown>).error === 'eligibility_answers_revision_conflict') {
        setSaveState({ status: 'conflict' })
        return
      }
      if (!response.ok) throw new Error('Your answers were not saved. Try again.')
      if (!body || typeof body !== 'object') throw new Error('The save response was invalid.')
      const receipt = body as Record<string, unknown>
      if (
        receipt.schemaVersion !== RECEIPT_VERSION
        || receipt.subjectId !== loadState.projection.subjectId
        || receipt.revision !== loadState.projection.revision + 1
        || receipt.status !== 'answers_saved'
        || receipt.decisionCreated !== false
      ) throw new Error('The save response was invalid.')
      setLoadState({
        status: 'ready',
        projection: { ...loadState.projection, revision: receipt.revision as number, answers: structuredClone(answers) },
      })
      setSaveState({ status: 'saved' })
    } catch (cause) {
      setSaveState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Your answers were not saved. Try again.',
      })
    }
  }

  if (loadState.status === 'loading') {
    return <Surface tier="tile" innerClassName={styles.entryState}>
      <p role="status" className="t-body">Loading your training questions…</p>
    </Surface>
  }
  if (loadState.status === 'error') {
    return <Surface tier="tile" innerClassName={styles.entryState}>
      <p role="alert" className={styles.error}>{loadState.message}</p>
      <button type="button" className="a-secondary" onClick={() => void retryLoad()}>Retry</button>
    </Surface>
  }

  const update = <Key extends keyof EligibilityAnswersInput>(key: Key, value: EligibilityAnswersInput[Key]) => {
    setAnswers(current => ({ ...current, [key]: value }))
  }
  const updateCondition = (
    key: keyof EligibilityAnswersInput['knownConditions'],
    value: EligibilityAnswersInput['knownConditions'][typeof key],
  ) => {
    setAnswers(current => ({
      ...current,
      knownConditions: { ...current.knownConditions, [key]: value },
    }))
  }

  return <Surface tier="feature" innerClassName={styles.formSurface}>
    <form className={styles.builder} onSubmit={event => void save(event)}>
      <div className={styles.sectionHeading}>
        <div>
          <p className="t-kicker">Before you train</p>
          <h2 className="t-headline-sm">Tell us about your current situation</h2>
          <p className="t-body">Your answers are saved for review. Saving them does not approve a program or clear you to train.</p>
        </div>
        <span className="a-badge">{loadState.projection.revision === 0 ? 'No answers saved yet' : `Saved response ${loadState.projection.revision}`}</span>
      </div>

      <div className={styles.fieldGrid}>
        <Choice label="Are you 18 or older?" value={answers.adultScope} onChange={value => update('adultScope', value as EligibilityAnswersInput['adultScope'])}>
          <option value="unknown">Not sure</option><option value="confirmed_18_plus">Yes</option><option value="minor">No</option>
        </Choice>
        <Choice label="How active are you currently?" value={answers.currentActivity} onChange={value => update('currentActivity', value as EligibilityAnswersInput['currentActivity'])}>
          <option value="unknown">Not sure</option><option value="regularly_active">Regularly active</option><option value="not_regularly_active">Not regularly active</option>
        </Choice>
      </div>

      <fieldset className={styles.fieldset}>
        <legend>Known health conditions</legend>
        <div className={styles.fieldGrid}>
          <Choice label="Heart or circulation condition" value={answers.knownConditions.cardiovascular} onChange={value => updateCondition('cardiovascular', value as EligibilityAnswersInput['knownConditions']['cardiovascular'])}><YesNoUnknownOptions /></Choice>
          <Choice label="Metabolic condition" value={answers.knownConditions.metabolic} onChange={value => updateCondition('metabolic', value as EligibilityAnswersInput['knownConditions']['metabolic'])}><YesNoUnknownOptions /></Choice>
          <Choice label="Kidney condition" value={answers.knownConditions.renal} onChange={value => updateCondition('renal', value as EligibilityAnswersInput['knownConditions']['renal'])}><YesNoUnknownOptions /></Choice>
        </div>
      </fieldset>

      <div className={styles.fieldGrid}>
        <Choice label="Are you currently experiencing signs or symptoms that may affect exercise?" value={answers.relevantSignsOrSymptoms} onChange={value => update('relevantSignsOrSymptoms', value as EligibilityAnswersInput['relevantSignsOrSymptoms'])}><YesNoUnknownOptions /></Choice>
        <Choice label="Preferred training intensity" value={answers.desiredIntensity} onChange={value => update('desiredIntensity', value as EligibilityAnswersInput['desiredIntensity'])}>
          <option value="unknown">Not sure</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="vigorous">Vigorous</option>
        </Choice>
        <Choice label="Are these answers complete?" value={answers.answerCertainty} onChange={value => update('answerCertainty', value as EligibilityAnswersInput['answerCertainty'])}>
          <option value="uncertain">Some answers are uncertain</option><option value="complete">Yes, they are complete</option>
        </Choice>
        <Choice label="Pregnancy or postpartum context" value={answers.pregnancyPostpartumContext} onChange={value => update('pregnancyPostpartumContext', value as EligibilityAnswersInput['pregnancyPostpartumContext'])}>
          <option value="unknown">Not sure</option><option value="none_reported">None to report</option><option value="pregnant">Pregnant</option><option value="postpartum">Postpartum</option><option value="prefer_not_to_say">Prefer not to say</option>
        </Choice>
        <Choice label="What kind of programming are you looking for?" value={answers.requestedProgrammingScope} onChange={value => update('requestedProgrammingScope', value as EligibilityAnswersInput['requestedProgrammingScope'])}>
          <option value="unknown">Not sure</option><option value="strength_or_general_fitness">Strength or general fitness</option><option value="specialized_programming">Specialized programming</option>
        </Choice>
      </div>

      <div className={styles.saveBar}>
        <div aria-live="polite">
          {saveState.status === 'saved' ? <p>Answers saved. This did not create a training decision.</p> : null}
          {saveState.status === 'conflict' ? <p role="alert" className={styles.error}>A newer saved response exists. Your edits are still here. Reload the saved response before trying again.</p> : null}
          {saveState.status === 'error' ? <p role="alert" className={styles.error}>{saveState.message}</p> : null}
          {saveState.status === 'idle' || saveState.status === 'saving' || saveState.status === 'reloading'
            ? <p className={styles.notice}>Unknown and “not sure” answers are saved as entered.</p>
            : null}
        </div>
        <div className={styles.saveActions}>
          {saveState.status === 'conflict' || saveState.status === 'error' || saveState.status === 'reloading'
            ? <button type="button" className="a-secondary" disabled={saveState.status === 'reloading'} onClick={() => void reloadSavedAnswers()}>
                {saveState.status === 'reloading' ? 'Reloading…' : 'Discard edits and reload saved answers'}
              </button>
            : null}
          <button type="submit" className="a-primary" disabled={saveState.status === 'saving' || saveState.status === 'reloading' || saveState.status === 'conflict'}>
            {saveState.status === 'saving' ? 'Saving…' : 'Save answers'}
          </button>
        </div>
      </div>
    </form>
  </Surface>
}
