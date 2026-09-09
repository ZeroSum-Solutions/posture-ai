'use client'

import {
  RecoveryContextChoiceV1Schema,
  RecoveryContextSignalV1Schema,
  type RecoveryContextV1,
} from '@/lib/training/contracts/recovery-context'
import styles from './StartingHistoryEditor.module.css'

const fields = [
  ['sleep', 'Sleep'], ['fatigue', 'Fatigue'], ['schedule', 'Schedule'], ['illness', 'Feeling unwell'],
] as const

export function RecoveryContextFields({ value, onChange, disabled = false }: {
  value: RecoveryContextV1
  onChange: (value: RecoveryContextV1) => void
  disabled?: boolean
}) {
  return <fieldset className={styles.fields} disabled={disabled}>
    <legend>Recovery check-in</legend>
    <p className="t-quiet">Share any concerns before reviewing your next target. Unknown answers stay unknown.</p>
    {fields.map(([field, label]) => <label key={field}>{label}<select
      value={value.report[field]}
      onChange={event => onChange({ ...value, report: { ...value.report, [field]: RecoveryContextSignalV1Schema.parse(event.target.value) } })}
    >
      <option value="unknown">Not sure / not answered</option>
      <option value="no_concern_reported">No concern to report</option>
      <option value="concern_reported">I have a concern</option>
    </select></label>)}
    <label>What would you like to review?<select value={value.choice ?? ''} onChange={event => {
      if (event.target.value === '') {
        onChange({ report: value.report })
      } else {
        onChange({ ...value, choice: RecoveryContextChoiceV1Schema.parse(event.target.value) })
      }
    }}>
      <option value="">Review my recorded performance</option>
      <option value="hold">Keep the current target</option>
      <option value="request_review">Request a program review</option>
      <option value="new_familiarization">Review a fresh starting point</option>
    </select></label>
    <p className="t-quiet">A check-in does not change saved workouts or automatically reduce your training. Review the result before accepting any new target.</p>
  </fieldset>
}
