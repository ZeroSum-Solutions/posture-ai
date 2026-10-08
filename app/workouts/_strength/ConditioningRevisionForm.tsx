'use client'

import { useState, type FormEvent } from 'react'
import { ConditioningRevisionSelectionV1Schema, type ConditioningRevisionSelectionV1 } from '@/lib/training/contracts/conditioning-revision'
import { Button, Select, TextField } from '@/components/ui'
import styles from './StrengthProgramBuilder.module.css'

export type ConditioningEditableBout = {
  sourceBoutId: string
  modalityId: string
  scheduledLocalDate: string
  acceptedDurationSeconds: number
  arrangement: 'separate' | 'paired_strength_first'
}
export type ConditioningModalityOption = { id: string; label: string; pairingAvailable: boolean }

type Props = {
  bouts: readonly ConditioningEditableBout[]
  modalities: readonly ConditioningModalityOption[]
  athleteTimezone: string
  disabled?: boolean
  onPreview: (selection: ConditioningRevisionSelectionV1) => void
}

export default function ConditioningRevisionForm({ bouts, modalities, athleteTimezone, disabled = false, onPreview }: Props) {
  const sharedModality = bouts.every(bout => bout.modalityId === bouts[0]?.modalityId) ? bouts[0]?.modalityId : ''
  const [modalityId, setModalityId] = useState(sharedModality ?? '')
  const [rows, setRows] = useState(() => bouts.map(bout => ({
    ...bout, minutes: String(Math.floor(bout.acceptedDurationSeconds / 60)), seconds: String(bout.acceptedDurationSeconds % 60),
  })))
  const [error, setError] = useState('')
  const modality = modalities.find(option => option.id === modalityId)
  const previewBlockedReason = rows.length === 0
    ? 'Add at least one upcoming bout before previewing changes.'
    : !modality
      ? 'Choose an available activity before previewing changes.'
      : undefined

  function edit(index: number, change: Partial<(typeof rows)[number]>) {
    setRows(current => current.map((row, position) => position === index ? { ...row, ...change } : row))
    setError('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    if (!modality) { setError('Choose an available activity.'); return }
    if (rows.some(row => !/^\d+$/.test(row.minutes) || !/^\d+$/.test(row.seconds)
      || Number(row.seconds) > 59)) {
      setError('Enter whole minutes and additional seconds from 0 to 59.'); return
    }
    const parsed = ConditioningRevisionSelectionV1Schema.safeParse({
      replacementModalityId: modalityId,
      futureBouts: rows.map(row => ({
        sourceBoutId: row.sourceBoutId, scheduledLocalDate: row.scheduledLocalDate,
        acceptedDurationSeconds: Number(row.minutes) * 60 + Number(row.seconds), arrangement: row.arrangement,
      })),
    })
    if (!parsed.success) { setError('Check each date and enter a duration from 1 to 30 minutes.'); return }
    if (rows.some(row => row.modalityId !== modalityId && Number(row.minutes) * 60 + Number(row.seconds) > 1200)) {
      setError('For a new activity, choose a starting duration from 1 to 20 minutes.'); return
    }
    if (!modality.pairingAvailable && rows.some(row => row.arrangement === 'paired_strength_first')) {
      setError('This activity requires a separate day. Choose a separate-day arrangement.'); return
    }
    setError('')
    onPreview(parsed.data)
  }

  return <form onSubmit={submit} className={styles.formSurface} aria-label="Edit future conditioning">
    <p>Dates use {athleteTimezone}. Completed and started sessions stay unchanged. Review the proposed schedule before accepting it.</p>
    <fieldset disabled={disabled} className={styles.fieldset}>
      <legend>Future conditioning</legend>
      <Select label="Activity" className={styles.clientPicker} value={modalityId} onChange={event => { setModalityId(event.target.value); setError('') }}>
        <option value="" disabled>Choose an activity</option>
        {modalities.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
      {rows.map((row, index) => <fieldset key={row.sourceBoutId} className={styles.fieldset}>
        <legend>Upcoming bout {index + 1}</legend>
        <div className={styles.fieldGrid}>
          <TextField label="Date" type="date" value={row.scheduledLocalDate} onChange={event => edit(index, { scheduledLocalDate: event.target.value })} />
          <TextField label="Minutes" type="text" inputMode="numeric" value={row.minutes} onChange={event => edit(index, { minutes: event.target.value })} />
          <TextField label="Additional seconds" type="text" inputMode="numeric" value={row.seconds} onChange={event => edit(index, { seconds: event.target.value })} />
          <Select label="Arrangement" value={row.arrangement} onChange={event => edit(index, { arrangement: event.target.value === 'paired_strength_first' ? 'paired_strength_first' : 'separate' })}>
            <option value="separate">Separate day from strength</option>
            <option value="paired_strength_first" disabled={!modality?.pairingAvailable}>Same day, strength first</option>
          </Select>
        </div>
      </fieldset>)}
      <Button type="submit" disabledReason={previewBlockedReason}>Preview conditioning changes</Button>
    </fieldset>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </form>
}
