'use client'

import { useRef, useState, type FormEvent } from 'react'
import type { ManualRecalibrationOfferV1 } from '@/lib/training/contracts/manual-recalibration'
import styles from './StrengthProgramBuilder.module.css'

export type ManualCalibrationConfirmation = { readonly requestId: string; readonly optionIndex: number; readonly outlierAcknowledged: boolean }
export type ManualCalibrationConfirmationOutcome = {
  status: 'accepted' | 'unconfirmed' | 'not_accepted'
  message: string
}

type Props = {
  offer: ManualRecalibrationOfferV1
  disabled?: boolean
  onConfirm: (input: ManualCalibrationConfirmation) => Promise<ManualCalibrationConfirmationOutcome>
}

function loadLabel(load: ManualRecalibrationOfferV1['currentLoad']): string {
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
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<ManualCalibrationConfirmationOutcome | null>(null)
  const envelope = useRef<ManualCalibrationConfirmation | null>(null)
  const inFlight = useRef(false)
  const option = offer.kind === 'options'
    ? offer.options.find(item => String(item.optionIndex) === selected)
    : undefined
  const requiresAcknowledgement = option?.confirmation.outlierDisposition === 'greater_than_20_percent_acknowledgement_required'
  const locked = disabled || pending || receipt?.status === 'accepted' || receipt?.status === 'unconfirmed'

  async function confirm(event: FormEvent) {
    event.preventDefault()
    if (disabled || inFlight.current || receipt?.status === 'accepted' || !option || (requiresAcknowledgement && !acknowledged)) return
    const input = envelope.current ?? Object.freeze({ requestId: crypto.randomUUID(), optionIndex: option.optionIndex, outlierAcknowledged: requiresAcknowledgement && acknowledged })
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

  return <form className={styles.formSurface} aria-label="Choose a new setting after effort review" onSubmit={event => void confirm(event)}>
    <h3 className="t-title-2">Review your starting setting</h3>
    <p>Current setting: {loadLabel(offer.currentLoad)}.</p>
    <p>Last comparable recorded load: {loadLabel(offer.sourceBindings.sourceDecision.lastComparableActualLoad)}.</p>
    {offer.kind === 'unavailable' ? <p role="status">No higher-resistance setting is available with this equipment. Keep the current target or request a program review.</p> : <>
      <p>Your logged effort calls for a new familiarization choice. Choose an available setting for future sessions; no setting is selected or recommended automatically. Confirming starts a new performance track; completed and started workouts stay unchanged.</p>
      {offer.currentLoad.basis === 'machine_assistance'
        ? <p>Less assistance increases the resistance you supply. These numbers describe assistance, not weight lifted.</p>
        : null}
      <label className={styles.clientPicker}>New setting
        <select className="a-input" value={selected} disabled={locked} onChange={event => { setSelected(event.target.value); setAcknowledged(false); setReceipt(null) }}>
          <option value="">Choose a setting</option>
          {offer.options.map(item => <option key={item.optionIndex} value={String(item.optionIndex)}>{loadLabel(item)}</option>)}
        </select>
      </label>
      {option ? <p>Selected: {loadLabel(option)}. This is your explicit familiarization choice.</p> : null}
      {requiresAcknowledgement ? <label className={styles.clientPicker}>
        <input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />
        I checked the unit and load basis for this change greater than 20%.
      </label> : null}
      <button type="submit" className="a-primary" disabled={disabled || pending || !option || (requiresAcknowledgement && !acknowledged) || receipt?.status === 'accepted'}>
        {pending ? 'Confirming…' : receipt?.status === 'unconfirmed' ? 'Retry the same selection' : 'Confirm new setting'}
      </button>
    </>}
    {receipt ? <p role={receipt.status === 'accepted' ? 'status' : 'alert'}>{receipt.message}</p> : null}
  </form>
}

export default function ManualRecalibrationChoices(props: Props) {
  // A different immutable offer cannot inherit a prior selection or retry envelope.
  return <Choices key={JSON.stringify(props.offer)} {...props} />
}
