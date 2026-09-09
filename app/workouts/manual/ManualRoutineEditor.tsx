'use client'

import Image from 'next/image'
import { useMemo, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { createLoadQuantity, isEnteredLoadAtMostCanonicalKg } from '@/lib/training/quantity'
import type { ManualRoutineExerciseChoice, ManualRoutineItem, ManualRoutineSaveInput } from './ManualRoutine.types'
import styles from './ManualRoutines.module.css'

type DraftItem = {
  itemId: string
  exercise: ManualRoutineExerciseChoice
  kind: 'strength' | 'conditioning'
  sets: string
  reps: string
  loadValue: string
  loadUnit: 'kg' | 'lb'
  durationSeconds: string
  restSeconds: string
}

function initialItem(exercise: ManualRoutineExerciseChoice): DraftItem {
  return {
    itemId: crypto.randomUUID(), exercise,
    kind: exercise.category === 'cardio' ? 'conditioning' : 'strength',
    sets: '', reps: '', loadValue: '', loadUnit: 'kg', durationSeconds: '', restSeconds: '',
  }
}

function savedItem(item: ManualRoutineItem): DraftItem {
  const exercise: ManualRoutineExerciseChoice = {
    id: item.referenceExerciseId,
    category: item.kind === 'conditioning' ? 'cardio' : 'saved',
    ...item.exerciseDisplay,
  }
  return item.kind === 'strength'
    ? {
        itemId: item.itemId, exercise, kind: item.kind,
        sets: String(item.sets), reps: String(item.reps), loadValue: item.load.value, loadUnit: item.load.unit,
        durationSeconds: '', restSeconds: item.restSeconds === undefined ? '' : String(item.restSeconds),
      }
    : {
        itemId: item.itemId, exercise, kind: item.kind,
        sets: '', reps: '', loadValue: '', loadUnit: 'kg', durationSeconds: String(item.durationSeconds),
        restSeconds: item.restSeconds === undefined ? '' : String(item.restSeconds),
      }
}

function integer(value: string, minimum: number, maximum: number): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function validLoad(value: string, unit: 'kg' | 'lb'): boolean {
  try {
    createLoadQuantity({ value, unit })
    return isEnteredLoadAtMostCanonicalKg({ value, unit }, '1000')
  } catch {
    return false
  }
}

export function createManualRoutineSaveInput(title: string, items: DraftItem[]): ManualRoutineSaveInput | null {
  if (!title.trim() || title.trim().length > 120 || items.length === 0) return null
  const output: ManualRoutineSaveInput['items'] = []
  for (const item of items) {
    let restSeconds: number | undefined
    if (item.restSeconds !== '') {
      const parsedRest = integer(item.restSeconds, 0, 3600)
      if (parsedRest === null) return null
      restSeconds = parsedRest
    }
    if (item.kind === 'strength') {
      const sets = integer(item.sets, 1, 20)
      const reps = integer(item.reps, 1, 100)
      if (sets === null || reps === null || !validLoad(item.loadValue, item.loadUnit)) return null
      output.push({ itemId: item.itemId, referenceExerciseId: item.exercise.id, kind: 'strength', sets, reps, load: { value: item.loadValue, unit: item.loadUnit }, ...(restSeconds === undefined ? {} : { restSeconds }) })
    } else {
      const durationSeconds = integer(item.durationSeconds, 1, 86_400)
      if (durationSeconds === null) return null
      output.push({ itemId: item.itemId, referenceExerciseId: item.exercise.id, kind: 'conditioning', durationSeconds, ...(restSeconds === undefined ? {} : { restSeconds }) })
    }
  }
  return { title: title.trim(), items: output }
}

function ExerciseReference({ item }: { item: DraftItem }) {
  return <>
    {item.exercise.media ? <>
      <Image className={styles.image} src={item.exercise.media.posterUrl} alt={item.exercise.media.alt} width={item.exercise.media.width} height={item.exercise.media.height} />
      <p className="t-quiet">Image by {item.exercise.media.source.author} · <a href={item.exercise.media.source.assetUrl} target="_blank" rel="noreferrer">wger image source</a> · <a href={item.exercise.media.source.license.url} target="_blank" rel="noreferrer">{item.exercise.media.source.license.shortName}</a> · unmodified</p>
    </> : null}
    <p className="t-body">{item.exercise.instructions}</p>
    <p className="t-quiet">By {item.exercise.source.author} · <a href={item.exercise.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`Source for ${item.exercise.name}`}>wger source</a> · <a href={item.exercise.source.license.url} target="_blank" rel="noreferrer">{item.exercise.source.license.shortName}</a></p>
  </>
}

export default function ManualRoutineEditor({
  exercises,
  availableExercises = exercises,
  initialTitle = '',
  initialItems,
  saveLabel = 'Save routine',
  disabled = false,
  onSave,
}: {
  exercises: readonly ManualRoutineExerciseChoice[]
  availableExercises?: readonly ManualRoutineExerciseChoice[]
  initialTitle?: string
  initialItems?: readonly ManualRoutineItem[]
  saveLabel?: string
  disabled?: boolean
  onSave: (input: ManualRoutineSaveInput) => Promise<{ routineId: string }>
}) {
  const [title, setTitle] = useState(initialTitle)
  const [items, setItems] = useState<DraftItem[]>(() => initialItems ? initialItems.map(savedItem) : exercises.map(initialItem))
  const [query, setQuery] = useState('')
  const [state, setState] = useState<{ status: 'idle' | 'saving' | 'error' | 'saved'; message?: string; routineId?: string }>({ status: 'idle' })
  const available = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US')
    return availableExercises.filter(exercise => (
      !normalized || [exercise.name, exercise.category, ...exercise.equipment].join(' ').toLocaleLowerCase('en-US').includes(normalized)
    )).slice(0, 12)
  }, [availableExercises, query])

  function patchItem(itemId: string, patch: Partial<DraftItem>) {
    setItems(current => current.map(item => item.itemId === itemId ? { ...item, ...patch } : item))
    setState({ status: 'idle' })
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    setItems(current => {
      const next = [...current]
      ;[next[index], next[target]] = [
        next[target],
        next[index],
      ]
      return next
    })
    setState({ status: 'idle' })
  }

  async function save() {
    const input = createManualRoutineSaveInput(title, items)
    if (!input) {
      setState({ status: 'error', message: 'Enter a routine name and valid targets for every exercise.' })
      return
    }
    setState({ status: 'saving' })
    try {
      const result = await onSave(input)
      setState({ status: 'saved', routineId: result.routineId, message: 'Routine saved.' })
    } catch (cause) {
      setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Routine could not be saved.' })
    }
  }

  return <section className={styles.editor} aria-labelledby="manual-editor-heading">
    <div>
      <p className="t-kicker">Manual routine</p>
      <h2 id="manual-editor-heading" className="t-headline-sm">Set your own targets</h2>
      <p className="t-body">Reference instructions are shown for context. Targets are entered by you, with no screening influence or automatic progression.</p>
    </div>
    <label className={styles.field}>Routine name
      <input className="a-input" value={title} maxLength={120} disabled={disabled} onChange={event => { setTitle(event.target.value); setState({ status: 'idle' }) }} />
    </label>
    <Surface tier="tile" innerClassName={styles.addExercise}>
      <div><p className="t-kicker">Exercise library</p><h3 className="t-title">Add another exercise</h3></div>
      <label className={styles.field}>Search all reference exercises
        <input className="a-input" type="search" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="Search name, category, or equipment" />
      </label>
      <div className={styles.exerciseChoices}>
        {available.map(exercise => <button key={exercise.id} type="button" className="a-secondary" disabled={disabled || items.length >= 280} onClick={() => setItems(current => current.length >= 280 ? current : [...current, initialItem(exercise)])}>Add {exercise.name}</button>)}
        {available.length === 0 ? <span className="t-quiet">No additional exercises match.</span> : null}
      </div>
    </Surface>
    {items.length === 0 ? <Surface tier="tile" innerClassName={styles.empty}><p className="t-body">Add at least one exercise to save this routine.</p></Surface> : null}
    <ol className={styles.editorList}>
      {items.map((item, index) => <li key={item.itemId}>
        <Surface tier="tile" innerClassName={styles.editorCard}>
          <div className={styles.itemHeading}>
            <div><span className="t-kicker">{String(index + 1).padStart(2, '0')}</span><h3 className="t-title">{item.exercise.name}</h3></div>
            <div className={styles.compactActions}>
              <button type="button" className="a-secondary" disabled={disabled || index === 0} aria-label={`Move ${item.exercise.name} up`} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="a-secondary" disabled={disabled || index === items.length - 1} aria-label={`Move ${item.exercise.name} down`} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="a-secondary" disabled={disabled} aria-label={`Remove ${item.exercise.name}`} onClick={() => { setItems(current => current.filter(candidate => candidate.itemId !== item.itemId)); setState({ status: 'idle' }) }}>Remove</button>
            </div>
          </div>
          <ExerciseReference item={item} />
          <label className={styles.field}>Target type
            <select className="a-input" aria-label={`Target type for ${item.exercise.name}`} value={item.kind} disabled={disabled} onChange={event => patchItem(item.itemId, { kind: event.target.value as DraftItem['kind'] })}>
              <option value="strength">Sets, reps, and load</option><option value="conditioning">Duration</option>
            </select>
          </label>
          {item.kind === 'strength' ? <div className={styles.dosageGrid}>
            <label className={styles.field}>Sets<input className="a-input" type="number" min="1" max="20" aria-label={`Sets for ${item.exercise.name}`} value={item.sets} disabled={disabled} onChange={event => patchItem(item.itemId, { sets: event.target.value })} /></label>
            <label className={styles.field}>Reps<input className="a-input" type="number" min="1" max="100" aria-label={`Reps for ${item.exercise.name}`} value={item.reps} disabled={disabled} onChange={event => patchItem(item.itemId, { reps: event.target.value })} /></label>
            <label className={styles.field}>Load<input className="a-input" type="text" inputMode="decimal" aria-label={`Load for ${item.exercise.name}`} placeholder="0" value={item.loadValue} disabled={disabled} onChange={event => patchItem(item.itemId, { loadValue: event.target.value })} /></label>
            <label className={styles.field}>Unit<select className="a-input" aria-label={`Load unit for ${item.exercise.name}`} value={item.loadUnit} disabled={disabled} onChange={event => patchItem(item.itemId, { loadUnit: event.target.value as 'kg' | 'lb' })}><option value="kg">kg</option><option value="lb">lb</option></select></label>
          </div> : <label className={styles.field}>Duration in seconds<input className="a-input" type="number" min="1" max="86400" aria-label={`Duration in seconds for ${item.exercise.name}`} value={item.durationSeconds} disabled={disabled} onChange={event => patchItem(item.itemId, { durationSeconds: event.target.value })} /></label>}
          <label className={styles.field}>Rest after this exercise (seconds, optional)<input className="a-input" type="number" min="0" max="3600" aria-label={`Rest after ${item.exercise.name}`} value={item.restSeconds} disabled={disabled} onChange={event => patchItem(item.itemId, { restSeconds: event.target.value })} /></label>
        </Surface>
      </li>)}
    </ol>
    {state.status === 'error' ? <p role="alert" className={styles.error}>{state.message}</p> : null}
    {state.status === 'saved' ? <p role="status" className={styles.notice}>{state.message}</p> : null}
    <div className={styles.actions}>
      <button type="button" className="a-primary" disabled={disabled || state.status === 'saving' || items.length === 0} onClick={() => void save()}>{state.status === 'saving' ? 'Saving…' : saveLabel}</button>
    </div>
  </section>
}
