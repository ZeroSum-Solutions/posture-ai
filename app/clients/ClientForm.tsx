'use client'
import { useRef, useState } from 'react'
import LegalDocumentView from '@/components/LegalDocumentView'
import useLegalDocument from '@/components/useLegalDocument'
import {
  ActionBar,
  Button,
  Checkbox,
  Dialog,
  SegmentedControl,
  Select,
  TextField,
  Textarea,
} from '@/components/ui'
import { inchesToCm, cmToInches, poundsToKg, kgToPounds, round1 } from '@/lib/units'
import { safeNextPath } from '@/lib/auth/safe-next'
import styles from './ClientForm.module.css'
import type { OperationMode } from '@/lib/prototype/runtime'

type UnitSystem = 'us' | 'metric'

/** Normalized, DB-shaped client field values emitted by the form. Empty optional
 *  fields are `null` (so edit can clear them); the parent maps these to a POST or
 *  PATCH and owns consent_recorded_at / practitioner_id. */
export type ClientPayload = {
  first_name: string
  last_name: string
  date_of_birth: string | null
  sex_at_birth: string | null
  height_cm: number | null
  weight_kg: number | null
  notes: string | null
  // Subject consent (create mode only) — the typed-name e-signature + relationship.
  signer_name?: string
  signer_relationship?: string
  legal_document_id?: string
  legal_document_version?: string
  legal_document_body_sha256?: string
}

export type ClientFormInitial = {
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  sex_at_birth?: string | null
  height_cm?: number | null
  weight_kg?: number | null
  notes?: string | null
}

type FieldErrors = {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  height?: string
  weight?: string
  consent?: string
  signer_name?: string
}

export default function ClientForm({
  mode,
  operationMode = 'governed',
  initial,
  cancelHref,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  operationMode?: OperationMode
  initial?: ClientFormInitial
  cancelHref: string
  /** Resolve to navigate away on success; throw an Error to surface its message. */
  onSubmit: (payload: ClientPayload) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [consentChecked, setConsentChecked] = useState(false)
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('us')
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const requiresConsent = mode === 'create' && operationMode === 'governed'
  const legal = useLegalDocument('subject_consent', requiresConsent)
  // Inputs hold the displayed unit (default US); stored values are metric, so
  // convert any initial height/weight from cm/kg to in/lb for the initial US view.
  const [form, setForm] = useState({
    first_name: initial?.first_name ?? '',
    last_name: initial?.last_name ?? '',
    date_of_birth: initial?.date_of_birth ?? '',
    sex_at_birth: initial?.sex_at_birth ?? '',
    height: initial?.height_cm != null ? String(round1(cmToInches(initial.height_cm))) : '',
    weight: initial?.weight_kg != null ? String(round1(kgToPounds(initial.weight_kg))) : '',
    notes: initial?.notes ?? '',
    signer_name: '',
    signer_relationship: 'self',
  })
  const dobRef = useRef<HTMLInputElement>(null)
  // Snapshot of the form's starting values, captured once via `useState`'s
  // lazy initializer (state, not a ref, so it's safe to read during render)
  // and never updated again. Compared against the live `form` below to gate
  // the discard-confirmation Dialog on an actually-dirty form, not merely
  // "the Cancel button was pressed".
  const [initialForm] = useState(() => form)
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm)

  const heightUnit = unitSystem === 'us' ? 'in' : 'cm'
  const weightUnit = unitSystem === 'us' ? 'lb' : 'kg'
  const heightPlaceholder = unitSystem === 'us' ? 'e.g. 69' : 'e.g. 175'
  const weightPlaceholder = unitSystem === 'us' ? 'e.g. 154' : 'e.g. 70'

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (name in fieldErrors) {
      setFieldErrors(prev => { const next = { ...prev }; delete next[name as keyof FieldErrors]; return next })
    }
  }

  // Switch units, converting any entered height/weight so the physical
  // measurement is preserved (the canonical stored value is always metric).
  function handleUnitChange(next: UnitSystem) {
    if (next === unitSystem) return
    const toUs = next === 'us'
    const conv = (val: string, toUsFn: (n: number) => number, toMetricFn: (n: number) => number) => {
      const s = val.trim()
      if (s === '') return val
      const n = parseFloat(s)
      if (!Number.isFinite(n)) return val
      return String(round1(toUs ? toUsFn(n) : toMetricFn(n)))
    }
    setForm(prev => ({
      ...prev,
      height: conv(prev.height, cmToInches, inchesToCm),
      weight: conv(prev.weight, kgToPounds, poundsToKg),
    }))
    setUnitSystem(next)
  }

  function handleCancel() {
    if (isDirty) setShowDiscardConfirm(true)
    // A hard navigation rather than next/link: Cancel needs to run the same
    // dirty check whichever way it exits, so it is a button, not a link — see
    // the discard Dialog below.
    else window.location.assign(safeNextPath(cancelHref))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const errors: FieldErrors = {}
    if (!form.first_name.trim()) {
      errors.first_name = 'First name is required.'
    }
    if (!form.last_name.trim()) {
      errors.last_name = 'Last name is required.'
    }
    // Date validation: check browser validity API for invalid dates
    if (dobRef.current && dobRef.current.value !== '' && !dobRef.current.validity.valid) {
      errors.date_of_birth = 'Please enter a valid date of birth (e.g. 1990-05-15).'
    }
    if (form.height !== '' && parseFloat(form.height) < 0) {
      errors.height = `Height must be a positive number (${heightUnit}).`
    }
    if (form.weight !== '' && parseFloat(form.weight) < 0) {
      errors.weight = `Weight must be a positive number (${weightUnit}).`
    }
    if (requiresConsent) {
      if (!legal.document) {
        errors.consent = legal.error ?? 'Consent terms are unavailable. Client creation is disabled.'
      }
      if (!form.signer_name.trim()) {
        errors.signer_name = 'Type the signer’s full name to sign.'
      }
      if (!consentChecked) {
        errors.consent = 'Subject consent is required before creating a record.'
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    const payload: ClientPayload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      date_of_birth: form.date_of_birth ? form.date_of_birth : null,
      sex_at_birth: form.sex_at_birth ? form.sex_at_birth : null,
      height_cm: form.height !== ''
        ? (unitSystem === 'us' ? round1(inchesToCm(parseFloat(form.height))) : parseFloat(form.height))
        : null,
      weight_kg: form.weight !== ''
        ? (unitSystem === 'us' ? round1(poundsToKg(parseFloat(form.weight))) : parseFloat(form.weight))
        : null,
      notes: form.notes.trim() ? form.notes.trim() : null,
      ...(requiresConsent
        ? {
            signer_name: form.signer_name.trim(),
            signer_relationship: form.signer_relationship,
            legal_document_id: legal.document!.documentId,
            legal_document_version: legal.document!.version,
            legal_document_body_sha256: legal.document!.bodySha256,
          }
        : {}),
    }

    setLoading(true)
    try {
      await onSubmit(payload)
      // Parent navigates on success; keep loading=true through the transition.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  const submitLabel = mode === 'create' ? 'Create Client' : 'Save Changes'
  const consentUnavailable = requiresConsent && !legal.document

  return (
    <>
      <form onSubmit={handleSubmit} noValidate aria-label={mode === 'create' ? 'New client form' : 'Edit client form'} className="app-stack">
        {error && (
          <p className="a-error" role="alert" aria-live="assertive">{error}</p>
        )}

        <div className={styles.grid2}>
          <TextField
            id="first_name"
            name="first_name"
            label="First Name"
            required
            aria-required="true"
            value={form.first_name}
            onChange={handleChange}
            placeholder="First name"
            error={fieldErrors.first_name}
          />
          <TextField
            id="last_name"
            name="last_name"
            label="Last Name"
            required
            aria-required="true"
            value={form.last_name}
            onChange={handleChange}
            placeholder="Last name"
            error={fieldErrors.last_name}
          />
        </div>

        <TextField
          id="date_of_birth"
          name="date_of_birth"
          ref={dobRef}
          label="Date of Birth"
          type="date"
          value={form.date_of_birth}
          onChange={handleChange}
          style={{ colorScheme: 'dark' }}
          error={fieldErrors.date_of_birth}
        />

        <Select
          id="sex_at_birth"
          name="sex_at_birth"
          label="Sex at Birth"
          value={form.sex_at_birth}
          onChange={handleChange}
        >
          <option value="">Select...</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </Select>

        <div className={styles.unitRow}>
          <span className="a-label" style={{ marginBottom: 0 }}>Measurements</span>
          <SegmentedControl
            label="Measurement units"
            size="sm"
            value={unitSystem}
            onChange={handleUnitChange}
            options={[
              { value: 'us', label: 'US (in / lb)' },
              { value: 'metric', label: 'Metric (cm / kg)' },
            ]}
          />
        </div>

        <div className={styles.grid2}>
          <TextField
            id="height"
            name="height"
            label={`Height (${heightUnit})`}
            type="number"
            inputMode="decimal"
            value={form.height}
            onChange={handleChange}
            placeholder={heightPlaceholder}
            step="0.1"
            error={fieldErrors.height}
          />
          <TextField
            id="weight"
            name="weight"
            label={`Weight (${weightUnit})`}
            type="number"
            inputMode="decimal"
            value={form.weight}
            onChange={handleChange}
            placeholder={weightPlaceholder}
            step="0.1"
            error={fieldErrors.weight}
          />
        </div>

        <Textarea
          id="notes"
          name="notes"
          label="Notes"
          value={form.notes}
          onChange={handleChange}
          placeholder="Optional notes about this client"
          rows={3}
        />

        {/* Subject consent — required at creation (the subject or their guardian
            signs via typed name). Immutable afterward, so hidden when editing.
            Remote consent (subject not present) is available from the client page. */}
        {requiresConsent && (
          <>
            <div className={styles.consentPanel} data-error={fieldErrors.consent ? 'true' : undefined}>
              {legal.isLoading && <p role="status" aria-live="polite" className="a-help">Loading consent terms…</p>}
              {legal.error && (
                <p role="alert" aria-live="assertive" className="a-error">{legal.error}</p>
              )}
              {legal.document && (
                <div className={styles.consentDocument}>
                  {/* h2, directly under the page's own h1 (TopBar's large
                      title) — the old hardcoded 3 skipped a level and was
                      an axe heading-order violation (UI audit #10). */}
                  <LegalDocumentView document={legal.document} headingLevel={2} compact />
                </div>
              )}

              <Select
                id="signer_relationship"
                name="signer_relationship"
                label="Who is giving consent?"
                value={form.signer_relationship}
                onChange={handleChange}
              >
                <option value="self">The client (self)</option>
                <option value="parent">Parent of the client</option>
                <option value="legal_guardian">Legal guardian of the client</option>
                <option value="other">Other authorized representative</option>
              </Select>

              <TextField
                id="signer_name"
                name="signer_name"
                label="Type full name to sign"
                required
                aria-required="true"
                value={form.signer_name}
                onChange={handleChange}
                placeholder="Signer’s full name"
                error={fieldErrors.signer_name}
              />

              <Checkbox
                id="consent_checkbox"
                checked={consentChecked}
                disabled={!legal.document}
                onChange={e => {
                  setConsentChecked(e.target.checked)
                  if (e.target.checked) setFieldErrors(prev => { const next = { ...prev }; delete next.consent; return next })
                }}
                aria-required="true"
                aria-invalid={Boolean(fieldErrors.consent)}
                aria-describedby={fieldErrors.consent ? 'error-consent' : undefined}
                label="By typing the name above and checking this box, I confirm I have read and agree to the posture-screening consent on behalf of the client."
              />
            </div>
            {fieldErrors.consent && (
              <p id="error-consent" data-testid="error-consent" className="a-error" role="alert">{fieldErrors.consent}</p>
            )}
          </>
        )}

        <ActionBar>
          <Button type="submit" size="lg" block loading={loading} disabledReason={consentUnavailable ? 'Consent terms are unavailable.' : undefined}>
            {submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        </ActionBar>
      </form>

      <Dialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="Discard changes?"
        description="Leaving now will lose what you've entered on this form."
        confirm={{ label: 'Discard', tone: 'danger', onConfirm: () => window.location.assign(safeNextPath(cancelHref)) }}
        cancel={{ label: 'Keep editing' }}
      />
    </>
  )
}
