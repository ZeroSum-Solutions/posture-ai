'use client'

import { useState } from 'react'
import type { StartingHistoryEntryV1 } from '@/lib/training/contracts/profile'
import { createRecalledStartingSet, type StartingHistoryExerciseOption } from './StartingHistory.model'
import type { EquipmentLoadBasis } from '@/lib/training/equipment'
import styles from './StartingHistoryEditor.module.css'

const basisLabels: Record<EquipmentLoadBasis, string> = {
  barbell_total: 'total including bar and collars',
  dumbbell_per_hand: 'per hand',
  dumbbell_single_implement: 'one dumbbell',
  machine_stack: 'stack setting',
  bodyweight_external: 'added external load',
  machine_assistance: 'assistance provided by the machine',
}

function loadHelp(basis: EquipmentLoadBasis): string {
  if (basis === 'bodyweight_external') {
    return 'Enter added external load only. Use 0 for bodyweight without added load; body mass is not added.'
  }
  if (basis === 'machine_assistance') {
    return 'Enter the nonnegative assistance setting shown by this machine.'
  }
  return `Enter the load ${basisLabels[basis]}.`
}

export function StartingHistoryEditor({ options, entries, onChange, disabled = false }: {
  options: readonly StartingHistoryExerciseOption[]
  entries: readonly StartingHistoryEntryV1[]
  onChange: (entries: StartingHistoryEntryV1[]) => void
  disabled?: boolean
}) {
  const [exerciseId, setExerciseId] = useState('')
  const [equipmentKey, setEquipmentKey] = useState('')
  const [load, setLoad] = useState('')
  const [reps, setReps] = useState('')
  const [error, setError] = useState<string | null>(null)
  const exercise = options.find(option => option.exerciseVersionId === exerciseId)
  const equipment = exercise?.equipmentOptions.find(option => JSON.stringify([option.equipmentId, option.basis, option.unit]) === equipmentKey)

  function add() {
    if (disabled) return
    try {
      if (entries.length >= 50) throw new Error('You can save up to 50 recent sets.')
      if (!equipment) throw new Error('Choose an exercise and its equipment first.')
      const entry = createRecalledStartingSet({
        options, exerciseVersionId: exerciseId, equipmentId: equipment.equipmentId,
        basis: equipment.basis, load, reps, performedAt: null,
        capturedAt: new Date().toISOString(),
      })
      onChange([...entries, entry])
      setLoad(''); setReps(''); setError(null)
    } catch (cause) {
      setError(cause instanceof Error && !cause.message.startsWith('[')
        ? cause.message : 'Check the load and repetitions, then try again.')
    }
  }

  return <section className={styles.editor} aria-label="Recent working sets">
    <h4>Recent working sets <span className="t-quiet">Optional</span></h4>
    <p className="t-body">Remember a recent set? Add it as starting context. You will still choose your starting loads. Recalled sets do not count as recorded progress.</p>
    {options.length === 0 ? <p className="t-quiet">Exercise choices appear when a program catalog and compatible equipment are available.</p> : <fieldset className={styles.fields} disabled={disabled}>
      <legend>Add a recalled set</legend>
      <label>Exercise<select value={exerciseId} onChange={event => { setExerciseId(event.target.value); setEquipmentKey(''); setLoad(''); setError(null) }}>
        <option value="">Choose exercise</option>
        {options.map(option => <option key={option.exerciseVersionId} value={option.exerciseVersionId}>{option.label}</option>)}
      </select></label>
      <label>Equipment<select value={equipmentKey} onChange={event => { setEquipmentKey(event.target.value); setLoad('') }}>
        <option value="">Choose equipment</option>
        {exercise?.equipmentOptions.map(option => <option key={JSON.stringify([option.equipmentId, option.basis, option.unit])} value={JSON.stringify([option.equipmentId, option.basis, option.unit])}>
          {option.equipmentId} · {basisLabels[option.basis]} · {option.unit}
        </option>)}
      </select></label>
      <label>Load{equipment ? ` (${equipment.unit})` : ''}<input inputMode="decimal" value={load} onChange={event => setLoad(event.target.value)} /></label>
      {equipment ? <p className="t-quiet">{loadHelp(equipment.basis)}</p> : null}
      <label>Repetitions<input inputMode="numeric" value={reps} onChange={event => setReps(event.target.value)} /></label>
      <button type="button" className="a-secondary" onClick={add}>Add recent set</button>
    </fieldset>}
    {error ? <p role="alert">{error}</p> : null}
    {entries.length > 0 ? <ul className={styles.entries}>{entries.map((entry, index) => <li key={`${index}:${entry.exerciseVersionId}`}>
      {options.find(option => option.exerciseVersionId === entry.exerciseVersionId)?.label ?? 'Previously selected exercise'}: {entry.equipmentLoad.quantity.entered.value} {entry.equipmentLoad.quantity.entered.unit} {basisLabels[entry.equipmentLoad.basis]} · {entry.reps} reps · recalled
      <button type="button" className="a-secondary" disabled={disabled} aria-label={`Remove recent set ${index + 1}`} onClick={() => onChange(entries.filter((_, entryIndex) => entryIndex !== index))}>Remove</button>
    </li>)}</ul> : null}
  </section>
}
