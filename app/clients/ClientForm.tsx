'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import { inchesToCm, cmToInches, poundsToKg, kgToPounds, round1 } from '@/lib/units'

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
        ? { signer_name: form.signer_name.trim(), signer_relationship: form.signer_relationship }
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

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: 'var(--background)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box',
    minHeight: '44px',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '6px',
  }
  const fieldStyle: React.CSSProperties = { marginBottom: '16px' }
  const errorStyle: React.CSSProperties = {
    fontSize: '0.78rem', color: 'var(--danger)', marginTop: '4px',
  }

  const submitLabel = mode === 'create'
    ? (loading ? 'Creating...' : 'Create Client')
    : (loading ? 'Saving...' : 'Save Changes')

  return (
    <div className="app-panel" style={{ padding: '28px 24px' }}>
      <form onSubmit={handleSubmit} noValidate aria-label={mode === 'create' ? 'New client form' : 'Edit client form'}>
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '12px',
              color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '4px' }}>
          <div>
            <label htmlFor="first_name" style={labelStyle}>
              First Name <span style={{ color: 'var(--danger)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="first_name"
              type="text" name="first_name" value={form.first_name}
              onChange={handleChange} placeholder="First name"
              aria-required="true"
              aria-describedby={fieldErrors.first_name ? 'error-first-name' : undefined}
              style={{ ...inputStyle, borderColor: fieldErrors.first_name ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
            />
            {fieldErrors.first_name && (
              <p id="error-first-name" data-testid="error-first-name" style={errorStyle} role="alert">{fieldErrors.first_name}</p>
            )}
          </div>
          <div>
            <label htmlFor="last_name" style={labelStyle}>
              Last Name <span style={{ color: 'var(--danger)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="last_name"
              type="text" name="last_name" value={form.last_name}
              onChange={handleChange} placeholder="Last name"
              aria-required="true"
              aria-describedby={fieldErrors.last_name ? 'error-last-name' : undefined}
              style={{ ...inputStyle, borderColor: fieldErrors.last_name ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
            />
            {fieldErrors.last_name && (
              <p id="error-last-name" data-testid="error-last-name" style={errorStyle} role="alert">{fieldErrors.last_name}</p>
            )}
          </div>
        </div>

        <div style={{ ...fieldStyle, marginTop: '16px' }}>
          <label htmlFor="date_of_birth" style={labelStyle}>Date of Birth</label>
          <input
            id="date_of_birth"
            ref={dobRef}
            type="date" name="date_of_birth" value={form.date_of_birth}
            onChange={handleChange}
            aria-describedby={fieldErrors.date_of_birth ? 'error-date-of-birth' : undefined}
            style={{ ...inputStyle, colorScheme: 'dark', borderColor: fieldErrors.date_of_birth ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
          />
          {fieldErrors.date_of_birth && (
            <p id="error-date-of-birth" data-testid="error-date-of-birth" style={errorStyle} role="alert">{fieldErrors.date_of_birth}</p>
          )}
        </div>

        <div style={fieldStyle}>
          <label htmlFor="sex_at_birth" style={labelStyle}>Sex at Birth</label>
          <select id="sex_at_birth" name="sex_at_birth" value={form.sex_at_birth} onChange={handleChange} style={inputStyle}>
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '16px', marginBottom: '8px' }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>Measurements</span>
          <div role="group" aria-label="Measurement units" style={{ display: 'inline-flex', background: 'var(--background)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '2px' }}>
            {([['us', 'US (in / lb)'], ['metric', 'Metric (cm / kg)']] as const).map(([val, lbl]) => {
              const active = unitSystem === val
              return (
                <button
                  key={val} type="button" onClick={() => handleUnitChange(val)} aria-pressed={active}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                    fontSize: '0.8rem', fontWeight: 600, minHeight: 'unset',
                    background: active ? 'var(--brand)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {lbl}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', marginBottom: '4px' }}>
          <div>
            <label htmlFor="height" style={labelStyle}>Height ({heightUnit})</label>
            <input
              id="height"
              type="number" name="height" value={form.height}
              onChange={handleChange} placeholder={heightPlaceholder} step="0.1"
              aria-describedby={fieldErrors.height ? 'error-height' : undefined}
              style={{ ...inputStyle, borderColor: fieldErrors.height ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
            />
            {fieldErrors.height && (
              <p id="error-height" data-testid="error-height" style={errorStyle} role="alert">{fieldErrors.height}</p>
            )}
          </div>
          <div>
            <label htmlFor="weight" style={labelStyle}>Weight ({weightUnit})</label>
            <input
              id="weight"
              type="number" name="weight" value={form.weight}
              onChange={handleChange} placeholder={weightPlaceholder} step="0.1"
              aria-describedby={fieldErrors.weight ? 'error-weight' : undefined}
              style={{ ...inputStyle, borderColor: fieldErrors.weight ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
            />
            {fieldErrors.weight && (
              <p id="error-weight" data-testid="error-weight" style={errorStyle} role="alert">{fieldErrors.weight}</p>
            )}
          </div>
        </div>

        <div style={{ ...fieldStyle, marginTop: '16px' }}>
          <label htmlFor="notes" style={labelStyle}>Notes</label>
          <textarea
            id="notes"
            name="notes" value={form.notes} onChange={handleChange}
            placeholder="Optional notes about this client" rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', minHeight: '80px' }}
          />
        </div>

        {/* Subject consent — required at creation (the subject or their guardian
            signs via typed name). Immutable afterward, so hidden when editing.
            Remote consent (subject not present) is available from the client page. */}
        {mode === 'create' && (
          <>
            <div style={{
              background: fieldErrors.consent ? 'rgba(239,68,68,0.08)' : 'rgba(0,152,243,0.08)',
              border: '1px solid ' + (fieldErrors.consent ? 'rgba(239,68,68,0.4)' : 'rgba(0,152,243,0.25)'),
              borderRadius: '10px', padding: '16px', marginBottom: '8px',
            }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '12px', lineHeight: 1.5 }}>
                Posture AI is a screening tool, not a medical diagnosis. Photos are processed on this
                device and never stored — only body-position measurements are saved, and no face-geometry
                template is created. The subject (or their parent/legal guardian) consents below.
              </p>

              <div style={{ marginBottom: '12px' }}>
                <label htmlFor="signer_relationship" style={labelStyle}>Who is giving consent?</label>
                <select id="signer_relationship" name="signer_relationship" value={form.signer_relationship} onChange={handleChange} style={inputStyle}>
                  <option value="self">The client (self)</option>
                  <option value="parent">Parent of the client</option>
                  <option value="legal_guardian">Legal guardian of the client</option>
                  <option value="other">Other authorized representative</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label htmlFor="signer_name" style={labelStyle}>
                  Type full name to sign <span style={{ color: 'var(--danger)' }} aria-hidden="true">*</span>
                </label>
                <input
                  id="signer_name" type="text" name="signer_name" value={form.signer_name}
                  onChange={handleChange} placeholder="Signer’s full name"
                  aria-required="true"
                  aria-describedby={fieldErrors.signer_name ? 'error-signer-name' : undefined}
                  style={{ ...inputStyle, borderColor: fieldErrors.signer_name ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
                />
                {fieldErrors.signer_name && (
                  <p id="error-signer-name" data-testid="error-signer-name" style={errorStyle} role="alert">{fieldErrors.signer_name}</p>
                )}
              </div>

              <label htmlFor="consent_checkbox" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                <input
                  id="consent_checkbox"
                  type="checkbox"
                  checked={consentChecked}
                  onChange={e => {
                    setConsentChecked(e.target.checked)
                    if (e.target.checked) setFieldErrors(prev => { const next = { ...prev }; delete next.consent; return next })
                  }}
                  aria-required="true"
                  aria-describedby={fieldErrors.consent ? 'error-consent' : undefined}
                  style={{ marginTop: '2px', width: '20px', height: '20px', cursor: 'pointer', flexShrink: 0, minHeight: 'unset' }}
                />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  By typing the name above and checking this box, I confirm I have read and agree to the
                  posture-screening consent on behalf of the client.
                </span>
              </label>
            </div>
            {fieldErrors.consent && (
              <p id="error-consent" data-testid="error-consent" style={{ ...errorStyle, marginBottom: '16px' }} role="alert">{fieldErrors.consent}</p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
          <Link href={cancelHref} style={{
            flex: 1, padding: '11px', background: 'rgba(255,255,255,0.06)',
            color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', fontWeight: 600, fontSize: '0.95rem',
            textAlign: 'center', textDecoration: 'none', display: 'flex',
            alignItems: 'center', justifyContent: 'center', minWidth: '100px',
          }}>
            Cancel
          </Link>
          <button type="submit" disabled={loading} className="app-gradient-action" style={{
            flex: 2, padding: '3px',
            background: loading ? 'rgba(0,152,243,0.3)' : undefined,
            color: loading ? '#6B7280' : '#fff',
            border: 'none', borderRadius: '8px', fontWeight: 600,
            fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
            minWidth: '120px',
          }}>
            <span>{submitLabel}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
