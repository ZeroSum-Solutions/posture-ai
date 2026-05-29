'use client'
import { useState, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type FieldErrors = {
  first_name?: string
  last_name?: string
  date_of_birth?: string
  height_cm?: string
  weight_kg?: string
  consent?: string
}

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [consentChecked, setConsentChecked] = useState(false)
  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '',
    sex_at_birth: '', height_cm: '', weight_kg: '', notes: '',
  })
  const dobRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (name in fieldErrors) {
      setFieldErrors(prev => { const next = { ...prev }; delete next[name as keyof FieldErrors]; return next })
    }
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
    if (form.height_cm !== '' && parseFloat(form.height_cm) < 0) {
      errors.height_cm = 'Height must be a positive number (cm).'
    }
    if (form.weight_kg !== '' && parseFloat(form.weight_kg) < 0) {
      errors.weight_kg = 'Weight must be a positive number (kg).'
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
    if (form.height_cm) body.height_cm = parseFloat(form.height_cm)
    if (form.weight_kg) body.weight_kg = parseFloat(form.weight_kg)
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
    color: '#F5F5F5', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
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
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
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
        <form onSubmit={handleSubmit} noValidate>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '12px',
              color: '#EF4444', fontSize: '0.875rem', marginBottom: '20px',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '4px' }}>
            <div>
              <label style={labelStyle}>First Name <span style={{ color: '#EF4444' }}>*</span></label>
              <input
                type="text" name="first_name" value={form.first_name}
                onChange={handleChange} placeholder="First name"
                style={{ ...inputStyle, borderColor: fieldErrors.first_name ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
              />
              {fieldErrors.first_name && (
                <p data-testid="error-first-name" style={errorStyle} role="alert">{fieldErrors.first_name}</p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Last Name <span style={{ color: '#EF4444' }}>*</span></label>
              <input
                type="text" name="last_name" value={form.last_name}
                onChange={handleChange} placeholder="Last name"
                style={{ ...inputStyle, borderColor: fieldErrors.last_name ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
              />
              {fieldErrors.last_name && (
                <p data-testid="error-last-name" style={errorStyle} role="alert">{fieldErrors.last_name}</p>
              )}
            </div>
          </div>

          <div style={{ ...fieldStyle, marginTop: '16px' }}>
            <label style={labelStyle}>Date of Birth</label>
            <input
              ref={dobRef}
              type="date" name="date_of_birth" value={form.date_of_birth}
              onChange={handleChange}
              style={{ ...inputStyle, colorScheme: 'dark', borderColor: fieldErrors.date_of_birth ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
            />
            {fieldErrors.date_of_birth && (
              <p data-testid="error-date-of-birth" style={errorStyle} role="alert">{fieldErrors.date_of_birth}</p>
            )}
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Sex at Birth</label>
            <select name="sex_at_birth" value={form.sex_at_birth} onChange={handleChange} style={inputStyle}>
              <option value="">Select...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', marginBottom: '4px' }}>
            <div>
              <label style={labelStyle}>Height (cm)</label>
              <input
                type="number" name="height_cm" value={form.height_cm}
                onChange={handleChange} placeholder="e.g. 175" step="0.1"
                style={{ ...inputStyle, borderColor: fieldErrors.height_cm ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
              />
              {fieldErrors.height_cm && (
                <p data-testid="error-height-cm" style={errorStyle} role="alert">{fieldErrors.height_cm}</p>
              )}
            </div>
            <div>
              <label style={labelStyle}>Weight (kg)</label>
              <input
                type="number" name="weight_kg" value={form.weight_kg}
                onChange={handleChange} placeholder="e.g. 70" step="0.1"
                style={{ ...inputStyle, borderColor: fieldErrors.weight_kg ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)' }}
              />
              {fieldErrors.weight_kg && (
                <p data-testid="error-weight-kg" style={errorStyle} role="alert">{fieldErrors.weight_kg}</p>
              )}
            </div>
          </div>

          <div style={{ ...fieldStyle, marginTop: '16px' }}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange}
              placeholder="Optional notes about this client" rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', minHeight: '80px' }} />
          </div>

          {/* Consent checkbox - required */}
          <div style={{
            background: fieldErrors.consent ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.08)',
            border: '1px solid ' + (fieldErrors.consent ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.25)'),
            borderRadius: '10px', padding: '16px', marginBottom: '8px',
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => {
                  setConsentChecked(e.target.checked)
                  if (e.target.checked) setFieldErrors(prev => { const next = { ...prev }; delete next.consent; return next })
                }}
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
            <p data-testid="error-consent" style={{ ...errorStyle, marginBottom: '16px' }} role="alert">{fieldErrors.consent}</p>
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
