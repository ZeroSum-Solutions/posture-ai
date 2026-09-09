'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrainingProgramOptionsV1 } from '@/lib/training/contracts/program-options'
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
import { StartingHistoryEditor } from './StartingHistoryEditor'
import type { StartingHistoryExerciseOption } from './StartingHistory.model'

type BuilderTab = 'profile' | 'schedule' | 'equipment' | 'calibration'
type Weekday = AthleteTrainingProfileV1['strengthDays'][number]
type EquipmentInventory = AthleteTrainingProfileV1['equipmentInventory'][number]

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
  programContext?: 'practice' | 'live'
  sessionHrefBase?: '/workouts' | '/train'
  startingHistoryOptions?: readonly StartingHistoryExerciseOption[]
  onLoadProgramOptions?: (subjectId: string, profileRevision: number) => Promise<TrainingProgramOptionsV1>
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
  programContext = 'practice',
  sessionHrefBase = '/workouts',
  startingHistoryOptions = [],
  onLoadProgramOptions,
  supportedCycleLengths,
  catalogState,
  onSaveProfile,
  onBuildPracticeDraft,
  onAcceptPracticeTargets,
  onPublishPracticeDraft,
}: StrengthProgramBuilderProps) {
  const [activeTab, setActiveTab] = useState<BuilderTab>('profile')
  const [profile, setProfile] = useState(initialProfile)
  const editVersion = useRef(0)
  const draftVersion = useRef(0)
  const saving = useRef(false)
  const [savePending, setSavePending] = useState(false)
  const [revision, setRevision] = useState(initialRevision)
  const [programOptions, setProgramOptions] = useState<TrainingProgramOptionsV1 | null>(null)
  const [optionsError, setOptionsError] = useState('')
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const subjectId = subject?.id
  const currentOptions = programOptions && programOptions.subjectId === subjectId && programOptions.profileRevision === revision ? programOptions : null
  useEffect(() => {
    if (!subjectId || revision < 1 || !onLoadProgramOptions) return
    let active = true
    void onLoadProgramOptions(subjectId, revision).then(options => {
      if (!active) return
      if (options.subjectId !== subjectId || options.profileRevision !== revision) throw new Error('Program choices are stale. Reload them before continuing.')
      setProgramOptions(options); setOptionsError('')
    }).catch(cause => {
      if (active) {
        setProgramOptions(null)
        setOptionsError(cause instanceof Error ? cause.message : 'Program choices could not be loaded.')
      }
    })
    return () => { active = false }
  }, [subjectId, revision, onLoadProgramOptions, optionsAttempt])
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [validationMessage, setValidationMessage] = useState('')
  const [cycleStartLocalDate, setCycleStartLocalDate] = useState(todayLocalDate)
  const [practiceState, setPracticeState] = useState<PracticeState>({ status: 'idle' })
  const canSave = subject !== null && onSaveProfile !== undefined
  const displayedCatalogState = currentOptions
    ? {
        status: 'ready' as const,
        reviewedExerciseCount: currentOptions.exerciseOptions.length,
        conditioningModeCount: currentOptions.conditioningModes.length,
        kind: programContext,
      }
    : programContext === 'live' && optionsError
      ? { status: 'pending' as const, message: optionsError }
      : catalogState
  const canBuildProgram = onBuildPracticeDraft !== undefined
    && revision > 0
    && (programContext === 'practice' || currentOptions !== null)
  const supportedCycles = useMemo(() => new Set(supportedCycleLengths), [supportedCycleLengths])

  function changeProfile(next: AthleteTrainingProfileV1) {
    editVersion.current += 1
    draftVersion.current += 1
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

  function nextEquipmentId(prefix: string): string {
    let suffix = 1
    while (profile.equipmentInventory.some(item => item.equipmentId === `${prefix}-${suffix}`)) suffix += 1
    return `${prefix}-${suffix}`
  }

  function addBarbellInventory() {
    changeProfile({
      ...profile,
      equipmentInventory: [...profile.equipmentInventory, {
        kind: 'barbell',
        equipmentId: nextEquipmentId('barbell'),
        unit: profile.preferredLoadUnit,
        barWeight: '',
        collarsTotalWeight: '0',
        plates: [],
      }],
    })
  }

  function addMachineInventory() {
    changeProfile({
      ...profile,
      equipmentInventory: [...profile.equipmentInventory, {
        kind: 'machine',
        equipmentId: nextEquipmentId('machine'),
        unit: profile.preferredLoadUnit,
        stackLoads: [],
      }],
    })
  }

  function addBodyweightExternalInventory() {
    changeProfile({
      ...profile,
      equipmentInventory: [...profile.equipmentInventory, {
        kind: 'bodyweight_external',
        equipmentId: nextEquipmentId('bodyweight-external'),
        unit: profile.preferredLoadUnit,
        externalLoads: [],
      }],
    })
  }

  function addAssistanceMachineInventory() {
    changeProfile({
      ...profile,
      equipmentInventory: [...profile.equipmentInventory, {
        kind: 'assistance_machine',
        equipmentId: nextEquipmentId('assistance-machine'),
        unit: profile.preferredLoadUnit,
        assistanceLoads: [],
      }],
    })
  }

  function updateEquipment(equipmentId: string, update: (item: EquipmentInventory) => EquipmentInventory) {
    changeProfile({
      ...profile,
      equipmentInventory: profile.equipmentInventory.map(item => item.equipmentId === equipmentId ? update(item) : item),
    })
  }

  function setEquipmentUnit(equipmentId: string, unit: EquipmentInventory['unit']) {
    updateEquipment(equipmentId, item => ({ ...item, unit }))
  }

  function setDumbbellLoads(equipmentId: string, value: string) {
    const loads = value.split(',').map(load => load.trim()).filter(Boolean)
    updateEquipment(equipmentId, item => item.kind === 'dumbbell' ? { ...item, perHandLoads: loads } : item)
  }

  function setMachineLoads(equipmentId: string, value: string) {
    const loads = value.split(',').map(load => load.trim()).filter(Boolean)
    updateEquipment(equipmentId, item => item.kind === 'machine' ? { ...item, stackLoads: loads } : item)
  }

  function setBodyweightExternalLoads(equipmentId: string, value: string) {
    const loads = value.split(',').map(load => load.trim()).filter(Boolean)
    updateEquipment(equipmentId, item => item.kind === 'bodyweight_external' ? { ...item, externalLoads: loads } : item)
  }

  function setAssistanceMachineLoads(equipmentId: string, value: string) {
    const loads = value.split(',').map(load => load.trim()).filter(Boolean)
    updateEquipment(equipmentId, item => item.kind === 'assistance_machine' ? { ...item, assistanceLoads: loads } : item)
  }

  function setBarbellWeight(equipmentId: string, field: 'barWeight' | 'collarsTotalWeight', value: string) {
    updateEquipment(equipmentId, item => item.kind === 'barbell' ? { ...item, [field]: value } : item)
  }

  function addBarbellPlate(equipmentId: string) {
    updateEquipment(equipmentId, item => item.kind === 'barbell'
      ? { ...item, plates: [...item.plates, { value: '', count: 0 }] }
      : item)
  }

  function setBarbellPlate(
    equipmentId: string,
    index: number,
    update: { value: string } | { count: number },
  ) {
    updateEquipment(equipmentId, item => item.kind === 'barbell'
      ? { ...item, plates: item.plates.map((plate, plateIndex) => plateIndex === index ? { ...plate, ...update } : plate) }
      : item)
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
    const sourceDraftVersion = ++draftVersion.current
    setPracticeState({ status: 'building' })
    try {
      const projection = await onBuildPracticeDraft({
        subjectId: subject.id,
        profileRevision: revision,
        cycleStartLocalDate,
      })
      if (draftVersion.current === sourceDraftVersion) setPracticeState({ status: 'ready', projection })
    } catch {
      if (draftVersion.current === sourceDraftVersion) setPracticeState({
        status: 'error',
        message: `${programContext === 'practice' ? 'Practice' : 'Program'} draft could not be built. Try again.`,
      })
    }
  }

  async function saveProfile() {
    if (saving.current) return
    const sourceEditVersion = editVersion.current
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
    saving.current = true
    setSavePending(true)
    try {
      const outcome = await onSaveProfile({ expectedRevision: revision, profile: validation.profile })
      if (outcome.status === 'saved') {
        setRevision(outcome.revision)
        setSaveState(editVersion.current === sourceEditVersion
          ? { status: 'saved', revision: outcome.revision } : { status: 'dirty' })
      } else if (outcome.status === 'conflict') {
        setSaveState({ status: 'conflict', current: outcome.current })
      } else {
        setSaveState(outcome)
      }
    } catch {
      setSaveState({ status: 'not_saved', message: 'Profile was not saved. Try again.' })
    } finally {
      saving.current = false
      setSavePending(false)
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
            <Chip band="neutral" size="sm">{profile.cycleLengthWeeks}-week foundation</Chip>
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
              <select className="a-input" value={profile.experience} onChange={event => {
                const experience = event.target.value as AthleteTrainingProfileV1['experience']
                const nextProfile = { ...profile, experience }
                if (experience !== 'intermediate') delete nextProfile.strengthProgrammingStyle
                changeProfile(nextProfile)
              }}>
                {profileOptionValues.experience.map(value => <option key={value} value={value}>{experienceLabels[value]}</option>)}
              </select>
            </label>
            {profile.experience === 'intermediate' ? <div className={styles.spanTwo}>
              <label>Strength programming
                <select className="a-input" value={profile.strengthProgrammingStyle ?? 'repeatable'} onChange={event => changeProfile({ ...profile, strengthProgrammingStyle: event.target.value as AthleteTrainingProfileV1['strengthProgrammingStyle'] })}>
                  <option value="repeatable">Repeatable sessions</option>
                  <option value="intermediate_undulating">Alternating heavy and volume sessions</option>
                </select>
              </label>
              <p className="t-quiet">Heavy and volume sessions keep separate starting loads and progression history. Choose the rhythm you prefer; neither approach guarantees better results.</p>
            </div> : null}
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
            <input className="a-input" type="date" value={cycleStartLocalDate} onChange={event => { draftVersion.current += 1; setCycleStartLocalDate(event.target.value); setPracticeState({ status: 'idle' }) }} />
          </label>
        </div>

        <div {...tabPanelProps('strength-builder', 'equipment', activeTab === 'equipment')} hidden={activeTab !== 'equipment'}>
          <div className={styles.sectionHeading}>
            <div><p className="t-kicker">03 · Equipment</p><h3 className="t-headline-sm">Record exact available loads</h3></div>
            <span className="t-quiet">Values stay in the entered unit</span>
          </div>
          <div className={styles.pendingPanel} role={displayedCatalogState.status === 'pending' ? 'status' : undefined}>
            <strong>{displayedCatalogState.status === 'ready' ? `${displayedCatalogState.reviewedExerciseCount} ${displayedCatalogState.kind === 'practice' ? 'synthetic practice' : 'reviewed'} exercise variants available` : 'Catalog connection pending'}</strong>
            <p className="t-body">{displayedCatalogState.status === 'ready' ? `${displayedCatalogState.kind === 'practice' ? 'Practice data only. ' : ''}Add the exact equipment this athlete can use.` : displayedCatalogState.message}</p>
          </div>
          <div className={styles.equipmentList}>
            {profile.equipmentInventory.map(item => item.kind === 'dumbbell' ? <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Dumbbell set</p><strong>{item.equipmentId}</strong></div>
              <label>Unit for {item.equipmentId}
                <select className="a-input" value={item.unit} onChange={event => setEquipmentUnit(item.equipmentId, event.target.value as EquipmentInventory['unit'])}>
                  {profileOptionValues.loadUnits.map(unit => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Available weights per dumbbell ({item.unit})
                <input className="a-input" inputMode="decimal" placeholder="2.5, 5, 7.5, 10" value={item.perHandLoads.join(', ')} onChange={event => setDumbbellLoads(item.equipmentId, event.target.value)} />
              </label>
              <p className="t-quiet">One listed dumbbell can be held with two hands for goblet work. Paired movements use two dumbbells at the selected per-hand weight.</p>
            </div> : item.kind === 'barbell' ? <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Barbell setup</p><strong>{item.equipmentId}</strong></div>
              <label>Unit for {item.equipmentId}
                <select className="a-input" value={item.unit} onChange={event => setEquipmentUnit(item.equipmentId, event.target.value as EquipmentInventory['unit'])}>
                  {profileOptionValues.loadUnits.map(unit => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                </select>
              </label>
              <div className={styles.fieldGrid}>
                <label>Bar weight for {item.equipmentId} ({item.unit})
                  <input className="a-input" inputMode="decimal" value={item.barWeight} onChange={event => setBarbellWeight(item.equipmentId, 'barWeight', event.target.value)} />
                </label>
                <label>Collars total weight for {item.equipmentId} ({item.unit})
                  <input className="a-input" inputMode="decimal" value={item.collarsTotalWeight} onChange={event => setBarbellWeight(item.equipmentId, 'collarsTotalWeight', event.target.value)} />
                </label>
              </div>
              {item.plates.map((plate, index) => <div key={index} className={styles.fieldGrid}>
                <label>Plate weight {index + 1} for {item.equipmentId} ({item.unit})
                  <input className="a-input" inputMode="decimal" value={plate.value} onChange={event => setBarbellPlate(item.equipmentId, index, { value: event.target.value })} />
                </label>
                <label>Plate count {index + 1} for {item.equipmentId}
                  <input className="a-input" type="number" min="0" step="1" value={plate.count} onChange={event => setBarbellPlate(item.equipmentId, index, { count: Number(event.target.value) })} />
                </label>
              </div>)}
              <button type="button" className="a-secondary" aria-label={`Add plate denomination for ${item.equipmentId}`} onClick={() => addBarbellPlate(item.equipmentId)}>Add plate denomination</button>
              <p className="t-quiet">Plate count is the total inventory. Achievable bar loads use symmetric pairs plus the configured bar and collars.</p>
            </div> : item.kind === 'machine' ? <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Machine stack</p><strong>{item.equipmentId}</strong></div>
              <label>Unit for {item.equipmentId}
                <select className="a-input" value={item.unit} onChange={event => setEquipmentUnit(item.equipmentId, event.target.value as EquipmentInventory['unit'])}>
                  {profileOptionValues.loadUnits.map(unit => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Available stack weights for {item.equipmentId} ({item.unit})
                <input className="a-input" inputMode="decimal" placeholder="5, 7.5, 10" value={item.stackLoads.join(', ')} onChange={event => setMachineLoads(item.equipmentId, event.target.value)} />
              </label>
              <p className="t-quiet">These exact resistance values apply only to this machine ID.</p>
            </div> : item.kind === 'bodyweight_external' ? <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Bodyweight plus external load</p><strong>{item.equipmentId}</strong></div>
              <label>Unit for {item.equipmentId}
                <select className="a-input" value={item.unit} onChange={event => setEquipmentUnit(item.equipmentId, event.target.value as EquipmentInventory['unit'])}>
                  {profileOptionValues.loadUnits.map(unit => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Available added external loads for {item.equipmentId} ({item.unit})
                <input className="a-input" inputMode="decimal" placeholder="0, 2.5, 5, 10" value={item.externalLoads.join(', ')} onChange={event => setBodyweightExternalLoads(item.equipmentId, event.target.value)} />
              </label>
              <p className="t-quiet">Record added external load only. Enter 0 for bodyweight without added load; body mass is never added to this value.</p>
            </div> : <div key={item.equipmentId} className={styles.equipmentCard}>
              <div><p className="t-kicker">Assistance machine</p><strong>{item.equipmentId}</strong></div>
              <label>Unit for {item.equipmentId}
                <select className="a-input" value={item.unit} onChange={event => setEquipmentUnit(item.equipmentId, event.target.value as EquipmentInventory['unit'])}>
                  {profileOptionValues.loadUnits.map(unit => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Available assistance settings for {item.equipmentId} ({item.unit})
                <input className="a-input" inputMode="decimal" placeholder="10, 20, 30, 40" value={item.assistanceLoads.join(', ')} onChange={event => setAssistanceMachineLoads(item.equipmentId, event.target.value)} />
              </label>
              <p className="t-quiet">Record the nonnegative assistance value shown by this machine. Do not encode assistance as a negative load.</p>
            </div>)}
            <div className={styles.saveActions}>
              <button type="button" className="a-secondary" onClick={addDumbbellInventory}>Add dumbbell set</button>
              <button type="button" className="a-secondary" onClick={addBarbellInventory}>Add barbell setup</button>
              <button type="button" className="a-secondary" onClick={addMachineInventory}>Add machine stack</button>
              <button type="button" className="a-secondary" onClick={addBodyweightExternalInventory}>Add bodyweight external loads</button>
              <button type="button" className="a-secondary" onClick={addAssistanceMachineInventory}>Add assistance machine</button>
            </div>
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
          {onLoadProgramOptions && !currentOptions ? <p role="status">{optionsError || 'Loading program choices…'}</p> : null}
          {onLoadProgramOptions && optionsError ? <button type="button" className="a-secondary" onClick={() => {
            setProgramOptions(null)
            setOptionsError('')
            setOptionsAttempt(value => value + 1)
          }}>Retry program choices</button> : null}
          {currentOptions ? <div className={styles.fieldGrid}>
            <label>Preferred conditioning activity<select
              value={profile.conditioningPreference?.catalogVersion === currentOptions.catalogVersion ? profile.conditioningPreference.preferredModalityIds[0] : ''}
              onChange={event => {
                if (!currentOptions.conditioningModes.some(mode => mode.modalityId === event.target.value)) return
                changeProfile({ ...profile, conditioningPreference: {
                  schemaVersion: 'conditioning-preference.v1', catalogVersion: currentOptions.catalogVersion,
                  preferredModalityIds: [event.target.value],
                } })
              }}
            >
              <option value="">Choose an activity</option>
              {currentOptions.conditioningModes.map(mode => <option key={mode.modalityId} value={mode.modalityId}>{mode.label}</option>)}
            </select></label>
            <p className="t-quiet">Choose the activity you want in this cycle, then save your profile.</p>
          </div> : null}
          <StartingHistoryEditor
            options={(currentOptions?.exerciseOptions ?? startingHistoryOptions).map(option => ({
              ...option,
              equipmentOptions: option.equipmentOptions.filter(equipment => profile.equipmentInventory.some(inventory => (
                inventory.equipmentId === equipment.equipmentId && inventory.unit === equipment.unit
                && (inventory.kind === 'barbell' ? equipment.basis === 'barbell_total'
                  : inventory.kind === 'machine' ? equipment.basis === 'machine_stack'
                    : inventory.kind === 'dumbbell' ? equipment.basis === 'dumbbell_per_hand' || equipment.basis === 'dumbbell_single_implement'
                      : inventory.kind === 'bodyweight_external' ? equipment.basis === 'bodyweight_external'
                        : equipment.basis === 'machine_assistance')
              ))),
            })).filter(option => option.equipmentOptions.length > 0)}
            entries={profile.startingHistory}
            disabled={saveState.status === 'saving' || saveState.status === 'validating' || practiceState.status === 'building'}
            onChange={startingHistory => changeProfile({ ...profile, startingHistory })}
          />
        </div>
      </Surface>

      {practiceState.status === 'ready'
        ? <PracticeDraftPanel
            projection={practiceState.projection}
            sessionHrefBase={sessionHrefBase}
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
          {onBuildPracticeDraft ? <button type="button" className="a-secondary" disabled={practiceState.status === 'building' || !canBuildProgram} onClick={() => void buildPractice()}>{practiceState.status === 'building' ? `Building ${programContext === 'practice' ? 'practice ' : ''}draft…` : `Build ${programContext === 'practice' ? 'practice ' : 'program '}draft`}</button> : null}
          {saveState.status === 'conflict' ? <button type="button" className="a-secondary" onClick={loadConflict}>Load revision {saveState.current.revision}</button> : null}
          <button
            type="button"
            className="a-primary"
            disabled={!canSave || savePending || saveState.status === 'saving' || saveState.status === 'validating' || saveState.status === 'idle' || saveState.status === 'saved'}
            onClick={() => void saveProfile()}
          >{saveState.status === 'saving' ? 'Saving profile…' : 'Save profile'}</button>
        </div>
      </div>
    </section>
  )
}
