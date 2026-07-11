'use client'
import { useState, useEffect, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'

type Practitioner = {
  display_name: string | null
  practice_name: string | null
  logo_storage_path: string | null
}

export default function SettingsPage() {
  const router = useRouter()
  const [practitioner, setPractitioner] = useState<Practitioner | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [practiceName, setPracticeName] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [orgName, setOrgName] = useState('')
  const [isCoveredEntity, setIsCoveredEntity] = useState(false)
  const [baaStatus, setBaaStatus] = useState<'not_required' | 'pending' | 'signed'>('not_required')
  const [baaSignedAt, setBaaSignedAt] = useState('')
  const [orgSaving, setOrgSaving] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/auth/sign-in'); return }
      supabase
        .from('practitioners')
        .select('display_name, practice_name, logo_storage_path')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setLoading(false)
          if (data) {
            setPractitioner(data)
            setDisplayName(data.display_name || '')
            setPracticeName(data.practice_name || '')
            // Fetch logo if exists
            if (data.logo_storage_path) {
              supabase.storage.from('practitioner-assets').createSignedUrl(data.logo_storage_path, 3600)
                .then(({ data: signedData }) => {
                  if (signedData?.signedUrl) setLogoUrl(signedData.signedUrl)
                })
            }
          }
        })
    })
  }, [router])

  useEffect(() => {
    fetch('/api/settings/organization')
      .then(async (r) => {
        if (!r.ok) throw new Error(`organization fetch failed (${r.status})`)
        return r.json()
      })
      .then(j => {
        const org = j?.organization
        if (!org) return
        setOrgName(org.name || '')
        setIsCoveredEntity(!!org.is_covered_entity)
        setBaaStatus(org.baa_status || 'not_required')
        setBaaSignedAt(org.baa_signed_at ? String(org.baa_signed_at).slice(0, 10) : '')
      })
      .catch(() => setToast({ type: 'error', message: 'Could not load organization settings. Refresh to try again.' }))
  }, [])

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName, practice_name: practiceName }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast('error', json.error || 'Failed to save settings')
      } else {
        setPractitioner(json.practitioner)
        showToast('success', 'Settings saved successfully')
      }
    } catch {
      showToast('error', 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveOrg(e: React.FormEvent) {
    e.preventDefault()
    setOrgSaving(true)
    try {
      const payload = {
        name: orgName.trim() || undefined,
        is_covered_entity: isCoveredEntity,
        baa_status: baaStatus,
        baa_signed_at: baaStatus === 'signed' ? (baaSignedAt || undefined) : null,
      }
      const res = await fetch('/api/settings/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast('error', json.error || 'Failed to save organization')
      } else {
        const org = json.organization
        if (org) {
          setOrgName(org.name || '')
          setIsCoveredEntity(!!org.is_covered_entity)
          setBaaStatus(org.baa_status || 'not_required')
          setBaaSignedAt(org.baa_signed_at ? String(org.baa_signed_at).slice(0, 10) : '')
        }
        showToast('success', 'Organization settings saved')
      }
    } catch {
      showToast('error', 'Network error')
    } finally {
      setOrgSaving(false)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const formData = new FormData()
      formData.append('logo', file)
      const res = await fetch('/api/settings', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        showToast('error', json.error || 'Failed to upload logo')
      } else {
        setLogoUrl(json.logo_url || null)
        showToast('success', 'Logo uploaded successfully')
      }
    } catch {
      showToast('error', 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPassword.trim()) {
      showToast('error', 'Enter your current password to confirm the change.')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      showToast('error', `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    setPasswordSaving(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) {
        showToast('error', 'Your session has expired. Please sign in again.')
        return
      }
      // Re-verify the current password before changing it — updateUser alone
      // would let any active session set a new password without proving identity.
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      })
      if (verifyError) {
        showToast('error', 'Current password is incorrect.')
        return
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        showToast('error', error.message)
      } else {
        showToast('success', 'Password updated successfully')
        setCurrentPassword('')
        setNewPassword('')
      }
    } catch {
      showToast('error', 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--background)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
        boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '16px',
  }

  if (loading) {
    return (
      <div className="app-standard-page app-standard-page--narrow">
        <p style={{ color: 'var(--text-secondary)' }}>Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="app-standard-page app-standard-page--narrow">
      <p className="app-page-kicker">Workspace control</p>
      <h1 className="app-page-heading">Settings</h1>
      <p className="app-page-lede" style={{ marginBottom: 28 }}>Manage your identity, organization, and account security in one place.</p>

      {/* Toast notification */}
      {toast && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: '10px',
            fontWeight: 500,
            fontSize: '0.9rem',
            background: toast.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: toast.type === 'success' ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(239,68,68,0.4)',
            color: toast.type === 'success' ? 'var(--maintain)' : 'var(--danger)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Profile section */}
      <div className="app-panel" style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Profile</h2>
        <form onSubmit={handleSaveProfile}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="display_name" style={labelStyle}>Display Name</label>
            <input
              id="display_name"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your display name"
              aria-label="Display name"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="practice_name" style={labelStyle}>Practice Name</label>
            <input
              id="practice_name"
              type="text"
              value={practiceName}
              onChange={e => setPracticeName(e.target.value)}
              placeholder="Your practice name"
              aria-label="Practice name"
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: saving ? 'rgba(0,152,243,0.4)' : 'var(--brand)',
              color: saving ? '#9CA3AF' : '#fff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Organization & Compliance section */}
      <div className="app-panel" style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Organization &amp; Compliance</h2>
        <form onSubmit={handleSaveOrg}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="org_name" style={labelStyle}>Organization Name</label>
            <input
              id="org_name"
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Your organization name"
              aria-label="Organization name"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <input
              id="covered_entity"
              type="checkbox"
              checked={isCoveredEntity}
              onChange={e => setIsCoveredEntity(e.target.checked)}
              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: 'var(--brand)', cursor: 'pointer' }}
            />
            <label htmlFor="covered_entity" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
              This organization is a HIPAA covered entity
              <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '4px' }}>
                Turning this on requires a signed Business Associate Agreement before practitioner mode can be used.
              </span>
            </label>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="baa_status" style={labelStyle}>Business Associate Agreement (BAA) status</label>
            <select
              id="baa_status"
              value={baaStatus}
              onChange={e => setBaaStatus(e.target.value as 'not_required' | 'pending' | 'signed')}
              aria-label="BAA status"
              style={inputStyle}
            >
              <option value="not_required">Not required</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
            </select>
          </div>

          {baaStatus === 'signed' && (
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="baa_signed_at" style={labelStyle}>BAA signed date</label>
              <input
                id="baa_signed_at"
                type="date"
                value={baaSignedAt}
                onChange={e => setBaaSignedAt(e.target.value)}
                aria-label="BAA signed date"
                style={inputStyle}
              />
            </div>
          )}

          {isCoveredEntity && baaStatus !== 'signed' && (
            <p
              role="status"
              style={{
                fontSize: '0.82rem',
                color: '#FBBF24',
                background: 'rgba(251,191,36,0.1)',
                border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '16px',
              }}
            >
              Practitioner mode is currently blocked for this organization until a signed BAA is recorded.
            </p>
          )}

          <button
            type="submit"
            disabled={orgSaving}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: orgSaving ? 'rgba(0,152,243,0.4)' : 'var(--brand)',
              color: orgSaving ? '#9CA3AF' : '#fff',
              border: 'none',
              cursor: orgSaving ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            {orgSaving ? 'Saving...' : 'Save Organization'}
          </button>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '10px' }}>
            These compliance details are self-attested by you and control whether the BAA gate applies.
          </p>
        </form>
      </div>

      {/* Logo section */}
      <div className="app-panel" style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Practice Logo</h2>
        {logoUrl && (
          <div style={{ marginBottom: '16px' }}>
            <img
              src={logoUrl}
              alt="Practice logo preview"
              style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'var(--background)' }}
            />
          </div>
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleLogoUpload}
          style={{ display: 'none' }}
          aria-label="Upload practice logo"
        />
        <button
          type="button"
          disabled={logoUploading}
          onClick={() => logoInputRef.current?.click()}
          style={{
            padding: '10px 20px',
            borderRadius: '8px',
            background: 'rgba(0,152,243,0.12)',
            color: logoUploading ? '#9CA3AF' : 'var(--brand)',
            border: '1px solid rgba(0,152,243,0.3)',
            cursor: logoUploading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '0.9rem',
          }}
        >
          {logoUploading ? 'Uploading...' : logoUrl ? 'Replace Logo' : 'Upload Logo'}
        </button>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
          JPEG, PNG, or WebP. Shown on PDF reports.
        </p>
      </div>

      {/* Password section */}
      <div className="app-panel" style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Change Password</h2>
        <form onSubmit={handlePasswordChange}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="current_password" style={labelStyle}>Current Password</label>
            <input
              id="current_password"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              aria-label="Current password"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="new_password" style={labelStyle}>New Password</label>
            <input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
              aria-label="New password"
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={passwordSaving || !newPassword.trim()}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              background: (passwordSaving || !newPassword.trim()) ? 'rgba(0,152,243,0.3)' : 'var(--brand)',
              color: (passwordSaving || !newPassword.trim()) ? '#6B7280' : '#fff',
              border: 'none',
              cursor: (passwordSaving || !newPassword.trim()) ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Sign out */}
      <form action="/api/auth/sign-out" method="POST">
        <button
          type="submit"
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            background: 'rgba(239,68,68,0.12)',
            color: 'var(--danger)',
            border: '1px solid rgba(239,68,68,0.3)',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Sign Out
        </button>
      </form>
    </div>
  )
}
