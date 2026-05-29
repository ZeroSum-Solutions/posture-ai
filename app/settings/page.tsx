'use client'
import { useState, useEffect, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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
    if (!newPassword.trim()) return
    setPasswordSaving(true)
    try {
      const supabase = createSupabaseBrowserClient()
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
    background: '#0A0A0B',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#F5F5F5',
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    color: '#A1A1AA',
    marginBottom: '6px',
  }

  const cardStyle: React.CSSProperties = {
    background: '#161618',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '16px',
  }

  if (loading) {
    return (
      <div style={{ padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }}>
        <p style={{ color: '#A1A1AA' }}>Loading settings...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>Settings</h1>

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
            color: toast.type === 'success' ? '#34D399' : '#F87171',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Profile section */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>Profile</h2>
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
              background: saving ? 'rgba(99,102,241,0.4)' : '#6366F1',
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

      {/* Logo section */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>Practice Logo</h2>
        {logoUrl && (
          <div style={{ marginBottom: '16px' }}>
            <img
              src={logoUrl}
              alt="Practice logo preview"
              style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: '#0A0A0B' }}
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
            background: 'rgba(99,102,241,0.12)',
            color: logoUploading ? '#9CA3AF' : '#818CF8',
            border: '1px solid rgba(99,102,241,0.3)',
            cursor: logoUploading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            fontSize: '0.9rem',
          }}
        >
          {logoUploading ? 'Uploading...' : logoUrl ? 'Replace Logo' : 'Upload Logo'}
        </button>
        <p style={{ fontSize: '0.8rem', color: '#71717A', marginTop: '8px' }}>
          JPEG, PNG, or WebP. Shown on PDF reports.
        </p>
      </div>

      {/* Password section */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>Change Password</h2>
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
              placeholder="New password (min 6 characters)"
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
              background: (passwordSaving || !newPassword.trim()) ? 'rgba(99,102,241,0.3)' : '#6366F1',
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
            color: '#EF4444',
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
