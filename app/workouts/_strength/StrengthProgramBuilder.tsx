'use client'

import { useMemo, useState } from 'react'
import { Chip } from '@/components/array/Chip'
import { Surface } from '@/components/array/Surface'
import { TabStrip, tabPanelProps, type TabOption } from '@/components/array/Tabs'
import type { AthleteTrainingProfileV1 } from '@/lib/training/contracts/profile'
import {
  profileOptionValues,
  validateStrengthProfile,
} from './StrengthBuilder.model'
import styles from './StrengthProgramBuilder.module.css'
import PracticeDraftPanel from './PracticeDraftPanel'
import type { AcceptedTrainingBuild, CreatedTrainingProgram, StartingTargetsSelection, TrainingBuildProjection } from './StrengthBuilder.gateway'

type BuilderTab = 'profile' | 'schedule' | 'equipment' | 'calibration'
type Weekday = AthleteTrainingProfileV1['strengthDays'][number]

const tabs: readonly TabOption<BuilderTab>[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'equipment', label: 'Equipment', displayLabel: 'Kit' },
  { value: 'calibration', label: 'Starting loads', displayLabel: 'Loads' },
]

const goalLabels: Record<AthleteTrainingProfileV1['goal'], string> = {
  strength: 'Build strength',
  general_fitness: 'General fitness',
}

const experienceLabels: Record<AthleteTrainingProfileV1['experience'], string> = {
  new_to_strength: 'New to strength training',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
}

const consistencyLabels: Record<AthleteTrainingProfileV1['recentConsistency'], string> = {
  none: 'No recent routine',
  intermittent: 'Intermittent',
  consistent: 'Consistent',
  unknown: 'Not recorded',
}

const weekdayLabels: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

export type SaveProfileOutcome =
  | { status: 'saved'; revision: number }
  | { status: 'conflict'; current: { revision: number; profile: AthleteTrainingProfileV1 } }
  | { status: 'not_saved'; message: string }

type SaveState =
  | { status: 'idle' }
  | { status: 'dirty' }
  | { status: 'validating' }
  | { status: 'saving' }
  | { status: 'saved'; revision: number; loaded?: boolean }
  | { status: 'conflict'; current: { revision: number; profile: AthleteTrainingProfileV1 } }
  | { status: 'not_saved'; message: string }

type PracticeState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'ready'; projection: TrainingBuildProjection }
  | { status: 'error'; message: string }

export interface StrengthProgramBuilderProps {
  subject: { id: string; name: string } | null
  initialProfile: AthleteTrainingProfileV1
  initialRevision: number
  supportedCycleLengths: readonly AthleteTrainingProfileV1['cycleLengthWeeks'][]
  catalogState:
    | { status: 'pending'; message: string }
    | { status: 'ready'; reviewedExerciseCount: number; conditioningModeCount: number; kind: 'practice' | 'live' }
  onSaveProfile?: (input: {
    expectedRevision: number
    profile: AthleteTrainingProfileV1
  }) => Promise<SaveProfileOutcome>
  onBuildPracticeDraft?: (input: {
    subjectId: string
    profileRevision: number
    cycleStartLocalDate: string
  }) => Promise<TrainingBuildProjection>
  onAcceptPracticeTargets?: (buildId: string, selection: StartingTargetsSelection) => Promise<AcceptedTrainingBuild>
  onPublishPracticeDraft?: (draftId: string) => Promise<CreatedTrainingProgram>
}

function todayLocalDate(): string {
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

function saveStateLabel(state: SaveState, canSave: boolean): string {
  if (!canSave) return 'Profile saving is not connected yet.'
  if (state.status === 'dirty') return 'Not saved'
  if (state.status === 'validating') return 'Checking profile…'
  if (state.status === 'saving') return 'Saving…'
  if (state.status === 'saved') return `${state.loaded ? 'Loaded' : 'Saved'} · revision ${state.revision}`
  if (state.status === 'conflict') return 'Profile changed elsewhere. Your edits are still here.'
  if (state.status === 'not_saved') return state.message
  return 'No unsaved changes'
}

export default function StrengthProgramBuilder({
  subject,
  initialProfile,
  initialRevision,
  supportedCycleLengths,
  catalogState,
  onSaveProfile,
  onBuildPracticeDraft,
  onAcceptPracticeTargets,
  onPublishPracticeDraft,
}: StrengthProgramBuilderProps) {
  const [activeTab, setActiveTab] = useState<BuilderTab>('profile')
  const [profile, setProfile] = useState(initialProfile)
  const [revision, setRevision] = useState(initialRevision)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [validationMessage, setValidationMessage] = useState('')
  const [cycleStartLocalDate, setCycleStartLocalDate] = useState(todayLocalDate)
  const [practiceState, setPracticeState] = useState<PracticeState>({ status: 'idle' })
  const canSave = subject !== null && onSaveProfile !== undefined
  const supportedCycles = useMemo(() => new Set(supportedCycleLengths), [supportedCycleLengths])

  function changeProfile(next: AthleteTrainingProfileV1) {
    setProfile(next)
    setSaveState({ status: 'dirty' })
    setPracticeState({ status: 'idle' })
    setValidationMessage('')
  }

  function toggleDay(day: Weekday) {
    const hasDay = profile.strengthDays.includes(day)
    const strengthDays = hasDay
      ? profile.strengthDays.filter(value => value !== day)
      : profileOptionValues.weekdays.filter(value => value === day || profile.strengthDays.includes(value))
    changeProfile({ ...profile, strengthDays })
  }

  function addDumbbellInventory() {
    let suffix = 1
    while (profile.equipmentInventory.some(item => item.equipmentId === `dumbbells-${suffix}`)) suffix += 1
    changeProfile({
      ...profile,
      equipmentInventory: [...profile.equipmentInventory, {
        kind: 'dumbbell',
        equipmentId: `dumbbells-${suffix}`,
        unit: profile.preferredLoadUnit,
        perHandLoads: [],
      }],
    })
  }

  function setDumbbellLoads(equipmentId: string, value: string) {
    const loads = value.split(',').map(load => load.trim()).filter(Boolean)
    changeProfile({
      ...profile,
      equipmentInventory: profile.equipmentInventory.map(item => item.equipmentId === equipmentId && item.kind === 'dumbbell'
        ? { ...item, perHandLoads: loads }
        : item),
    })
  }

  async function buildPractice() {
    if (!subject || !onBuildPracticeDraft) return
    const validation = validateStrengthProfile(profile)
    if (validation.status === 'invalid') {
      setPracticeState({ status: 'error', message: 'Review the profile, schedule, and exact equipment values before building.' })
      return
    }
    if (revision < 1 || !['idle', 'saved'].includes(saveState.status)) {
      setPracticeState({ status: 'error', message: 'Save the current profile before building a program.' })
      return
    }
    setPracticeState({ status: 'building' })
    try {
      const projection = await onBuildPracticeDraft({
        subjectId: subject.id,
        profileRevision: revision,
        cycleStartLocalDate,
      })
      setPracticeState({ status: 'ready', projection })
    } catch {
      setPracticeState({ status: 'error', message: 'Practice draft could not be built. Try again.' })
    }
  }

  async function saveProfile() {
    setSaveState({ status: 'validating' })
    const validation = validateStrengthProfile(profile)
    if (validation.status === 'invalid') {
      const scheduleInvalid = validation.fieldErrors.strengthDays
      setValidationMessage(scheduleInvalid ? 'Choose at least two strength days before saving.' : 'Review the highlighted profile fields before saving.')
      setSaveState({ status: 'not_saved', message: 'Not saved' })
      return
    }
    if (!onSaveProfile || !subject) {
      setSaveState({ status: 'not_saved', message: 'Profile saving is not connected yet.' })
      return
    }

    setSaveState({ status: 'saving' })
    try {
      const outcome = await onSaveProfile({ expectedRevision: revision, profile: validation.profile })
      if (outcome.status === 'saved') {
        setRevision(outcome.revision)
        setSaveState({ status: 'saved', revision: outcome.revision })
      } else if (outcome.status === 'conflict') {
        setSaveState({ status: 'conflict', current: outcome.current })
      } else {
        setSaveState(outcome)
      }
    } catch {
      setSaveState({ status: 'not_saved', message: 'Profile was not saved. Try again.' })
    }
  }

  function loadConflict() {
    if (saveState.status !== 'conflict') return
    setProfile(saveState.current.profile)
    setRevision(saveState.current.revision)
    setSaveState({ status: 'saved', revision: saveState.current.revision, loaded: true })
    setValidationMessage('')
  }

  const stateText = saveStateLabel(saveState, canSave)
  const stateRole = saveState.status === 'conflict' || saveState.status === 'not_saved' ? 'alert' : 'status'

  return (
    <section className={styles.builder} aria-labelledby="strength-builder-heading">
      <Surface tier="feature" innerClassName={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrowRow}>
            <p className="t-kicker">Strength program</p>
            <Chip band="neutral" size="sm">8-week foundation</Chip>
          </div>
          <h2 id="strength-builder-heading" className="t-headline-sm">Build a strength program</h2>
          <p className="t-body">
            Set the athlete profile, weekly rhythm, exact equipment, and starting loads before reviewing a draft.
          </p>
        </div>
        <div className={styles.subjectCard}>
          <span className="t-kicker">Athlete</span>
          <strong>{subject?.name ?? 'No linked athlete selected'}</strong>
          <span className="t-quiet">{subject ? `Profile revision ${revision}` : 'A linked training subject is required to save.'}</span>
        </div>
      </Surface>

      <TabStrip idBase="strength-builder" options={tabs} value={activeTab} onChange={setActiveTab} label="Strength program setup" />

      <Surface tier="tile" innerClassName={styles.formSurface}>
        <div {...tabPanelProps('strength-builder', 'profile', activeTab === 'profile')} hidden={activeTab !== 'profile'}>
          <div className={styles.sectionHeading}>
            <div><p className="t-kicker">01 · Profile</p><h3 className="t-headline-sm">Training starting point</h3></div>
            <span className="t-quiet">No scan required</span>
          </div>
          <div className={styles.fieldGrid}>
            <label>Training goal
              <select className="a-input" value={profile.goal} onChange={event => changeProfile({ ...profile, goal: event.target.value as AthleteTrainingProfileV1['goal'] })}>
                {profileOptionValues.goals.map(value => <option key={value} value={value}>{goalLabels[value]}</option>)}
              </select>
            </label>
            <label>Experience
              <select className="a-input" value={profile.experience} onChange={event => changeProfile({ ...profile, experience: event.target.value as AthleteTrainingProfileV1['experience'] })}>
                {profileOptionValues.experience.map(value => <option key={value} value={value}>{experienceLabels[value]}</option>)}
              </select>
            </label>
            <label>Recent consistency
              <select className="a-input" value={profile.recentConsistency} onChange={event => changeProfile({ ...profile, recentConsistency: event.target.value as AthleteTrainingProfileV1['recentConsistency'] })}>
                {profileOptionValues.recentConsistency.map(value => <option key={value} value={value}>{consistencyLabels[value]}</option>)}
              </select>
            </label>
            <label>Preferred load unit
              <select className="a-input" value={profile.preferredLoadUnit} onChange={event => changeProfile({ ...profile, preferredLoadUnit: event.target.value as AthleteTrainingProfileV1['preferredLoadUnit'] })}>
                {profileOptionValues.loadUnits.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
              </select>
            </label>
            <label className={styles.spanTwo}>Local timezone
              <input className="a-input" value={profile.localTimezone} onChange={event => changeProfile({ ...profile, localTimezone: event.target.value })} />
            </label>
          </div>
        </div>

        <div {...tabPanelProps('strength-builder', 'schedule', activeTab === 'schedule')} hidden={activeTab !== 'schedule'}>
          <div className={styles.sectionHeading}>
            <div><p className="t-kicker">02 · Schedule</p><h3 className="t-headline-sm">Choose the weekly rhythm</h3></div>
            <span className="t-quiet">2–4 strength days</span>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>Cycle length</legend>
            <div className={styles.cycleGrid}>
              {profileOptionValues.cycleLengths.map(weeks => {
                const isSupported = supportedCycles.has(weeks)
                return <button
                  key={weeks}
                  type="button"
                  className={styles.choiceCard}
                  aria-label={`${weeks} weeks ${isSupported ? 'Available' : 'Planned'}`}
                  aria-pressed={profile.cycleLengthWeeks === weeks}
                  disabled={!isSupported}
                  onClick={() => changeProfile({ ...profile, cycleLengthWeeks: weeks })}
                ><strong>{weeks}</strong><span>weeks</span><small>{isSupported ? 'Available' : 'Planned'}</small></button>
              })}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>Strength days</legend>
            <div className={styles.dayGrid}>
              {profileOptionValues.weekdays.map(day => <button key={day} type="button" className={styles.dayButton} aria-pressed={profile.strengthDays.includes(day)} onClick={() => toggleDay(day)}>{weekdayLabels[day]}</button>)}
            </div>
          </fieldset>
          <label className={styles.budgetField}>Session time budget
            <select className="a-input" value={profile.sessionTimeBudgetMinutes} onChange={event => changeProfile({ ...profile, sessionTimeBudgetMinutes: Number(event.target.value) as AthleteTrainingProfileV1['sessionTimeBudgetMinutes'] })}>
              {profileOptionValues.sessionMinutes.map(value => <option key={value} value={value}>{value} minutes</option>)}
            </select>
          </label>
          <label className={styles.budgetField}>Cycle start date
            <input className="a-input" type="date" value={cycleStartLocalDate} onChange={event => { setCycleStartLocalDate(event.target.value); setPracticeState({ status: 'idle' }) }} />
          </label>
        </div>

        <div {...tabPanelProps('strength-builder', 'equipment', activeTab === 'equipment')} hidden={activeTab !== 'equipment'}>
          <div className={styles.sectionHeading}>
            <div><p className="t-kicker">03 · Equipment</p><h3 className="t-headline-sm">Record exact available loads</h3></div>
            <span className="t-quiet">Values stay in the entered unit</span>
          </div>
          <div className={styles.pendingPanel} role={catalogState.status === 'pending' ? 'status' : undefined}>
            <strong>{catalogState.status === 'ready' ? `${catalogState.reviewedExerciseCount} ${catalogState.kind === 'practice' ? 'synthetic practice' : 'reviewed'} exercise variants available` : 'Catalog connection pending'}</strong>
            <p className="t-body">{catalogState.status === 'ready' ? `${catalogState.kind === 'practice' ? 'Practice data only. ' : ''}Add the exact equipment this athlete can use.` : catalogState.message}</p>
          </div>
          <div className={styles.equipmentList}>
            {profile.equipmentInventory.filter(item => item.kind === 'dumbbell').map(item => item.kind === 'dumbbell' ? <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Dumbbell set</p><strong>{item.equipmentId}</strong></div>
              <label>Available weights per dumbbell ({item.unit})
                <input className="a-input" inputMode="decimal" placeholder="2.5, 5, 7.5, 10" value={item.perHandLoads.join(', ')} onChange={event => setDumbbellLoads(item.equipmentId, event.target.value)} />
              </label>
              <p className="t-quiet">One listed dumbbell can be held with two hands for goblet work. Paired movements use two dumbbells at the selected per-hand weight.</p>
            </div> : null)}
            <button type="button" className="a-secondary" onClick={addDumbbellInventory}>Add dumbbell set</button>
          </div>
        </div>

        <div {...tabPanelProps('strength-builder', 'calibration', activeTab === 'calibration')} hidden={activeTab !== 'calibration'}>
          <div className={styles.sectionHeading}>
            <div><p className="t-kicker">04 · Starting loads</p><h3 className="t-headline-sm">Calibrate each reviewed variant</h3></div>
            <span className="t-quiet">Explicit acceptance required</span>
          </div>
          <div className={styles.pendingPanel}>
            <strong>No load is inferred from posture or body size.</strong>
            <p className="t-body">Starting-load acceptance becomes available after reviewed exercise variants are connected. A recalled load remains context, not progression evidence.</p>
          </div>
        </div>
      </Surface>

      {practiceState.status === 'ready'
        ? <PracticeDraftPanel
            projection={practiceState.projection}
            onAcceptTargets={practiceState.projection.buildId && onAcceptPracticeTargets
              ? selection => onAcceptPracticeTargets(practiceState.projection.buildId!, selection)
              : undefined}
            onPublishDraft={onPublishPracticeDraft}
          />
        : practiceState.status === 'error'
          ? <p role="alert" className={styles.error}>{practiceState.message}</p>
          : null}

      <div className={styles.saveBar}>
        <div>
          <span className="t-kicker">Profile state</span>
          <p className="t-body" role={stateRole}>{stateText}</p>
          {validationMessage ? <p className={styles.error} role="alert">{validationMessage}</p> : null}
        </div>
        <div className={styles.saveActions}>
          {onBuildPracticeDraft ? <button type="button" className="a-secondary" disabled={practiceState.status === 'building'} onClick={() => void buildPractice()}>{practiceState.status === 'building' ? 'Building practice draft…' : 'Build practice draft'}</button> : null}
          {saveState.status === 'conflict' ? <button type="button" className="a-secondary" onClick={loadConflict}>Load revision {saveState.current.revision}</button> : null}
          <button
            type="button"
            className="a-primary"
            disabled={!canSave || saveState.status === 'saving' || saveState.status === 'validating' || saveState.status === 'idle' || saveState.status === 'saved'}
            onClick={() => void saveProfile()}
          >{saveState.status === 'saving' ? 'Saving profile…' : 'Save profile'}</button>
        </div>
      </div>
    </section>
  )
}
