'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import LegalDocumentView from '@/components/LegalDocumentView'
import useLegalDocument from '@/components/useLegalDocument'
import { Surface } from '@/components/array/Surface'
import { inchesToCm, cmToInches, poundsToKg, kgToPounds, round1 } from '@/lib/units'
import styles from './ClientForm.module.css'

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
  initial,
  cancelHref,
  onSubmit,
}: {
  mode: 'create' | 'edit'
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
  const legal = useLegalDocument('subject_consent', mode === 'create')
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
    if (mode === 'create') {
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
      ...(mode === 'create'
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

  const submitLabel = mode === 'create'
    ? (loading ? 'Creating...' : 'Create Client')
    : (loading ? 'Saving...' : 'Save Changes')

  return (
    <Surface tier="feature">
      <form onSubmit={handleSubmit} noValidate aria-label={mode === 'create' ? 'New client form' : 'Edit client form'} className="a-form">
        {error && (
          <p className="a-error" role="alert" aria-live="assertive">{error}</p>
        )}

        <div className={styles.grid2}>
          <div className="a-field">
            <label className="a-label" htmlFor="first_name">
              First Name <span style={{ color: 'var(--review)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="first_name"
              className="a-input"
              type="text" name="first_name" value={form.first_name}
              onChange={handleChange} placeholder="First name"
              aria-required="true"
              aria-invalid={Boolean(fieldErrors.first_name)}
              aria-describedby={fieldErrors.first_name ? 'error-first-name' : undefined}
            />
            {fieldErrors.first_name && (
              <p id="error-first-name" data-testid="error-first-name" className="a-error" role="alert">{fieldErrors.first_name}</p>
            )}
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="last_name">
              Last Name <span style={{ color: 'var(--review)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="last_name"
              className="a-input"
              type="text" name="last_name" value={form.last_name}
              onChange={handleChange} placeholder="Last name"
              aria-required="true"
              aria-invalid={Boolean(fieldErrors.last_name)}
              aria-describedby={fieldErrors.last_name ? 'error-last-name' : undefined}
            />
            {fieldErrors.last_name && (
              <p id="error-last-name" data-testid="error-last-name" className="a-error" role="alert">{fieldErrors.last_name}</p>
            )}
          </div>
        </div>

        <div className="a-field">
          <label className="a-label" htmlFor="date_of_birth">Date of Birth</label>
          <input
            id="date_of_birth"
            ref={dobRef}
            className="a-input"
            type="date" name="date_of_birth" value={form.date_of_birth}
            onChange={handleChange}
            style={{ colorScheme: 'dark' }}
            aria-invalid={Boolean(fieldErrors.date_of_birth)}
            aria-describedby={fieldErrors.date_of_birth ? 'error-date-of-birth' : undefined}
          />
          {fieldErrors.date_of_birth && (
            <p id="error-date-of-birth" data-testid="error-date-of-birth" className="a-error" role="alert">{fieldErrors.date_of_birth}</p>
          )}
        </div>

        <div className="a-field">
          <label className="a-label" htmlFor="sex_at_birth">Sex at Birth</label>
          <select id="sex_at_birth" className="a-select" name="sex_at_birth" value={form.sex_at_birth} onChange={handleChange}>
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>

        <div className={styles.unitRow}>
          <span className="a-label" style={{ marginBottom: 0 }}>Measurements</span>
          <div role="group" aria-label="Measurement units" className={styles.unitToggle}>
            {([['us', 'US (in / lb)'], ['metric', 'Metric (cm / kg)']] as const).map(([val, lbl]) => {
              const active = unitSystem === val
              return (
                <button
                  key={val} type="button" onClick={() => handleUnitChange(val)} aria-pressed={active}
                  className={styles.unitButton}
                >
                  {lbl}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.grid2}>
          <div className="a-field">
            <label className="a-label" htmlFor="height">Height ({heightUnit})</label>
            <input
              id="height"
              className="a-input"
              type="number" name="height" value={form.height}
              onChange={handleChange} placeholder={heightPlaceholder} step="0.1"
              aria-invalid={Boolean(fieldErrors.height)}
              aria-describedby={fieldErrors.height ? 'error-height' : undefined}
            />
            {fieldErrors.height && (
              <p id="error-height" data-testid="error-height" className="a-error" role="alert">{fieldErrors.height}</p>
            )}
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="weight">Weight ({weightUnit})</label>
            <input
              id="weight"
              className="a-input"
              type="number" name="weight" value={form.weight}
              onChange={handleChange} placeholder={weightPlaceholder} step="0.1"
              aria-invalid={Boolean(fieldErrors.weight)}
              aria-describedby={fieldErrors.weight ? 'error-weight' : undefined}
            />
            {fieldErrors.weight && (
              <p id="error-weight" data-testid="error-weight" className="a-error" role="alert">{fieldErrors.weight}</p>
            )}
          </div>
        </div>

        <div className="a-field">
          <label className="a-label" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            className="a-textarea"
            name="notes" value={form.notes} onChange={handleChange}
            placeholder="Optional notes about this client" rows={3}
          />
        </div>

        {/* Subject consent — required at creation (the subject or their guardian
            signs via typed name). Immutable afterward, so hidden when editing.
            Remote consent (subject not present) is available from the client page. */}
        {mode === 'create' && (
          <>
            <div className={styles.consentPanel} data-error={fieldErrors.consent ? 'true' : undefined}>
              {legal.isLoading && <p role="status" aria-live="polite" className="a-help">Loading consent terms…</p>}
              {legal.error && (
                <p role="alert" aria-live="assertive" className="a-error">{legal.error}</p>
              )}
              {legal.document && (
                <div className={styles.consentDocument}>
                  <LegalDocumentView document={legal.document} headingLevel={3} compact />
                </div>
              )}

              <div className="a-field">
                <label className="a-label" htmlFor="signer_relationship">Who is giving consent?</label>
                <select id="signer_relationship" className="a-select" name="signer_relationship" value={form.signer_relationship} onChange={handleChange}>
                  <option value="self">The client (self)</option>
                  <option value="parent">Parent of the client</option>
                  <option value="legal_guardian">Legal guardian of the client</option>
                  <option value="other">Other authorized representative</option>
                </select>
              </div>

              <div className="a-field">
                <label className="a-label" htmlFor="signer_name">
                  Type full name to sign <span style={{ color: 'var(--review)' }} aria-hidden="true">*</span>
                </label>
                <input
                  id="signer_name" className="a-input" type="text" name="signer_name" value={form.signer_name}
                  onChange={handleChange} placeholder="Signer’s full name"
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.signer_name)}
                  aria-describedby={fieldErrors.signer_name ? 'error-signer-name' : undefined}
                />
                {fieldErrors.signer_name && (
                  <p id="error-signer-name" data-testid="error-signer-name" className="a-error" role="alert">{fieldErrors.signer_name}</p>
                )}
              </div>

              <label htmlFor="consent_checkbox" className={styles.consentCheck}>
                <input
                  id="consent_checkbox"
                  type="checkbox"
                  checked={consentChecked}
                  disabled={!legal.document}
                  onChange={e => {
                    setConsentChecked(e.target.checked)
                    if (e.target.checked) setFieldErrors(prev => { const next = { ...prev }; delete next.consent; return next })
                  }}
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.consent)}
                  aria-describedby={fieldErrors.consent ? 'error-consent' : undefined}
                />
                <span className="t-body">
                  By typing the name above and checking this box, I confirm I have read and agree to the
                  posture-screening consent on behalf of the client.
                </span>
              </label>
            </div>
            {fieldErrors.consent && (
              <p id="error-consent" data-testid="error-consent" className="a-error" role="alert">{fieldErrors.consent}</p>
            )}
          </>
        )}

        <div className={styles.actions}>
          <Link href={cancelHref} className="a-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || (mode === 'create' && !legal.document)}
            className="a-primary"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Surface>
  )
}
