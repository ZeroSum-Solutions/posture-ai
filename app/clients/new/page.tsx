'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '',
    sex_at_birth: '', height_cm: '', weight_kg: '', notes: '',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!consentChecked) {
      setError('Client consent is required before creating a record.')
      return
    }
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First name and last name are required.')
      return
    }

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
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px',
  }
  const fieldStyle: React.CSSProperties = { marginBottom: '16px' }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Clients
        </Link>
      </div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        New Client
      </h1>
      <div style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '32px',
      }}>
        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '12px',
              color: '#EF4444', fontSize: '0.85rem', marginBottom: '20px',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>First Name *</label>
              <input type="text" name="first_name" value={form.first_name}
                onChange={handleChange} required placeholder="First name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Last Name *</label>
              <input type="text" name="last_name" value={form.last_name}
                onChange={handleChange} required placeholder="Last name" style={inputStyle} />
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Date of Birth</label>
            <input type="date" name="date_of_birth" value={form.date_of_birth}
              onChange={handleChange} style={{ ...inputStyle, colorScheme: 'dark' }} />
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={labelStyle}>Height (cm)</label>
              <input type="number" name="height_cm" value={form.height_cm}
                onChange={handleChange} placeholder="e.g. 175" step="0.1" min="0" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Weight (kg)</label>
              <input type="number" name="weight_kg" value={form.weight_kg}
                onChange={handleChange} placeholder="e.g. 70" step="0.1" min="0" style={inputStyle} />
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange}
              placeholder="Optional notes about this client" rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          {/* Consent checkbox - required */}
          <div style={{
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: '10px', padding: '16px', marginBottom: '24px',
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                style={{ marginTop: '2px', width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ fontSize: '0.875rem', color: '#D4D4D8', lineHeight: 1.5 }}>
                <strong style={{ color: '#F5F5F5' }}>Client has consented to posture imaging.</strong>{' '}
                The client understands that Posture AI is a screening tool, not a medical diagnostic device,
                and has given informed consent for posture data collection and analysis.
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <Link href="/clients" style={{
              flex: 1, padding: '11px', background: 'rgba(255,255,255,0.06)',
              color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', fontWeight: 600, fontSize: '0.95rem',
              textAlign: 'center', textDecoration: 'none', display: 'block',
            }}>
              Cancel
            </Link>
            <button type="submit" disabled={loading || !consentChecked} style={{
              flex: 2, padding: '11px',
              background: loading || !consentChecked ? 'rgba(99,102,241,0.3)' : '#6366F1',
              color: loading || !consentChecked ? '#6B7280' : '#fff',
              border: 'none', borderRadius: '8px', fontWeight: 600,
              fontSize: '0.95rem', cursor: loading || !consentChecked ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
