'use client'
import { useState, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { inchesToCm, cmToInches, poundsToKg, kgToPounds, round1 } from '@/lib/units'

type UnitSystem = 'us' | 'metric'

type FieldErrors = {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  height?: string
  weight?: string
  consent?: string
}

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [consentChecked, setConsentChecked] = useState(false)
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('us')
  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '',
    sex_at_birth: '', height: '', weight: '', notes: '',
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
    if (!consentChecked) {
      errors.consent = 'Client consent is required before creating a record.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated.'); setLoading(false); return }

    const body: Record<string, unknown> = {
      practitioner_id: user.id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      consent_recorded_at: new Date().toISOString(),
    }
    if (form.date_of_birth) body.date_of_birth = form.date_of_birth
    if (form.sex_at_birth) body.sex_at_birth = form.sex_at_birth
    if (form.height) {
      const h = parseFloat(form.height)
      body.height_cm = round1(unitSystem === 'us' ? inchesToCm(h) : h)
    }
    if (form.weight) {
      const w = parseFloat(form.weight)
      body.weight_kg = round1(unitSystem === 'us' ? poundsToKg(w) : w)
    }
    if (form.notes.trim()) body.notes = form.notes.trim()

    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(json.error || 'Failed to create client.')
      return
    }

    router.push(`/clients/${json.client.id}`)
    router.refresh()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: '#0A0A0B',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    color: '#F5F5F5', fontSize: '0.9rem', boxSizing: 'border-box',
    minHeight: '44px',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '6px',
  }
  const fieldStyle: React.CSSProperties = { marginBottom: '16px' }
  const errorStyle: React.CSSProperties = {
    fontSize: '0.78rem', color: '#EF4444', marginTop: '4px',
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
          &#8592; Back to Clients
        </Link>
      </div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        New Client
      </h1>
      <div style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '24px 20px',
      }}>
        <form onSubmit={handleSubmit} noValidate aria-label="New client form">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px', padding: '12px',
                color: '#EF4444', fontSize: '0.875rem', marginBottom: '20px',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '4px' }}>
            <div>
              <label htmlFor="first_name" style={labelStyle}>
                First Name <span style={{ color: '#EF4444' }} aria-hidden="true">*</span>
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
                Last Name <span style={{ color: '#EF4444' }} aria-hidden="true">*</span>
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
            <div role="group" aria-label="Measurement units" style={{ display: 'inline-flex', background: '#0A0A0B', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '2px' }}>
              {([['us', 'US (in / lb)'], ['metric', 'Metric (cm / kg)']] as const).map(([val, lbl]) => {
                const active = unitSystem === val
                return (
                  <button
                    key={val} type="button" onClick={() => handleUnitChange(val)} aria-pressed={active}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                      fontSize: '0.8rem', fontWeight: 600, minHeight: 'unset',
                      background: active ? '#6366F1' : 'transparent',
                      color: active ? '#fff' : '#A1A1AA',
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

          {/* Consent checkbox - required */}
          <div style={{
            background: fieldErrors.consent ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.08)',
            border: '1px solid ' + (fieldErrors.consent ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.25)'),
            borderRadius: '10px', padding: '16px', marginBottom: '8px',
          }}>
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
              <span style={{ fontSize: '0.875rem', color: '#D4D4D8', lineHeight: 1.5 }}>
                <strong style={{ color: '#F5F5F5' }}>Client has consented to posture imaging.</strong>{' '}
                The client understands that Posture AI is a screening tool, not a clinical assessment,
                and has given informed consent for posture data collection and analysis.
              </span>
            </label>
          </div>
          {fieldErrors.consent && (
            <p id="error-consent" data-testid="error-consent" style={{ ...errorStyle, marginBottom: '16px' }} role="alert">{fieldErrors.consent}</p>
          )}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
            <Link href="/clients" style={{
              flex: 1, padding: '11px', background: 'rgba(255,255,255,0.06)',
              color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', fontWeight: 600, fontSize: '0.95rem',
              textAlign: 'center', textDecoration: 'none', display: 'flex',
              alignItems: 'center', justifyContent: 'center', minWidth: '100px',
            }}>
              Cancel
            </Link>
            <button type="submit" disabled={loading} style={{
              flex: 2, padding: '11px',
              background: loading ? 'rgba(99,102,241,0.3)' : '#6366F1',
              color: loading ? '#6B7280' : '#fff',
              border: 'none', borderRadius: '8px', fontWeight: 600,
              fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
              minWidth: '120px',
            }}>
              {loading ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
