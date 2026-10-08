'use client'

import { useRef, useState, type FormEvent } from 'react'
import type { ActiveCalibrationOfferV1 } from '@/lib/training/contracts/active-calibration'
import { Select } from '@/components/ui'
import styles from './StrengthProgramBuilder.module.css'

export type CalibrationConfirmation = { readonly requestId: string; readonly optionIndex: number }
export type CalibrationConfirmationOutcome = {
  status: 'accepted' | 'unconfirmed' | 'not_accepted'
  message: string
}

type Props = {
  offer: ActiveCalibrationOfferV1
  disabled?: boolean
  onConfirm: (input: CalibrationConfirmation) => Promise<CalibrationConfirmationOutcome>
}

function loadLabel(load: ActiveCalibrationOfferV1['currentLoad']): string {
  const value = `${load.quantity.entered.value} ${load.quantity.entered.unit}`
  switch (load.basis) {
    case 'machine_assistance': return `${value} assistance from the machine`
    case 'bodyweight_external': return `${value} added externally to bodyweight`
    case 'dumbbell_per_hand': return `${value} per hand`
    case 'dumbbell_single_implement': return `${value} for one dumbbell`
    case 'barbell_total': return `${value} total barbell load`
    case 'machine_stack': return `${value} machine stack setting`
  }
}

function Choices({ offer, disabled = false, onConfirm }: Props) {
  const [selected, setSelected] = useState('')
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<CalibrationConfirmationOutcome | null>(null)
  const envelope = useRef<CalibrationConfirmation | null>(null)
  const inFlight = useRef(false)
  const option = offer.kind === 'options'
    ? offer.options.find(item => String(item.optionIndex) === selected)
    : undefined
  const locked = disabled || pending || receipt?.status === 'accepted' || receipt?.status === 'unconfirmed'

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (disabled || inFlight.current || receipt?.status === 'accepted' || !option) return
    const input = envelope.current ?? Object.freeze({ requestId: crypto.randomUUID(), optionIndex: option.optionIndex })
    envelope.current = input
    inFlight.current = true
    setPending(true)
    try {
      const outcome = await onConfirm(input)
      setReceipt(outcome)
      if (outcome.status === 'not_accepted') envelope.current = null
    } catch {
      setReceipt({ status: 'unconfirmed', message: 'The save could not be confirmed. Retry the same selection to check its result.' })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <form className={styles.formSurface} aria-label="Choose a new familiarization setting" onSubmit={event => void confirm(event)}>
    <h3 className="t-title-2">A fresh starting point</h3>
    <p>Current setting: {loadLabel(offer.currentLoad)}.</p>
    {offer.kind === 'unavailable' ? <p role="status">No easier setting is available with this equipment. Keep the current target or request a program review.</p> : <>
      <p>Choose an achievable easier setting for future sessions. Confirming starts a new performance track; completed and started workouts stay unchanged.</p>
      {offer.currentLoad.basis === 'machine_assistance'
        ? <p>More assistance reduces the resistance you supply. These numbers describe assistance, not weight lifted.</p>
        : null}
      <Select label="New setting" className={styles.clientPicker} value={selected} disabled={locked} onChange={event => { setSelected(event.target.value); setReceipt(null) }}>
        <option value="">Choose a setting</option>
        {offer.options.map(item => <option key={item.optionIndex} value={String(item.optionIndex)}>{loadLabel(item)}</option>)}
      </Select>
      {option ? <p>Selected: {loadLabel(option)}. This is your explicit familiarization choice.</p> : null}
      <button type="submit" className="a-primary" disabled={disabled || pending || !option || receipt?.status === 'accepted'}>
        {pending ? 'Confirming…' : receipt?.status === 'unconfirmed' ? 'Retry the same selection' : 'Confirm new setting'}
      </button>
    </>}
    {receipt ? <p role={receipt.status === 'accepted' ? 'status' : 'alert'}>{receipt.message}</p> : null}
  </form>
}

export default function ActiveCalibrationChoices(props: Props) {
  // A different immutable offer cannot inherit a prior selection or retry envelope.
  return <Choices key={JSON.stringify(props.offer)} {...props} />
}
