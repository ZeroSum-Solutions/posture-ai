'use client'
import { useState, useEffect, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { Surface } from '@/components/array/Surface'
import styles from './SettingsPage.module.css'

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

  const signOutFormRef = useRef<HTMLFormElement>(null)

  // Two sign-out calls happen here on purpose — neither one alone is sufficient:
  //
  // - The POST to /api/auth/sign-out runs supabase.auth.signOut() SERVER-SIDE. That's
  //   what actually revokes the session (GoTrue global scope) and clears the httpOnly
  //   session cookies this browser client can't touch. Drop it and the session survives.
  //
  // - supabase.auth.signOut() called here, in the browser, is what makes GoTrue publish
  //   on its BroadcastChannel. AuthSessionGuard (components/AuthSessionGuard.tsx) listens
  //   for that SIGNED_OUT broadcast to clear protected UI in every OTHER open tab. A
  //   server-only sign-out (which is all the Array redesign originally did here) revokes
  //   the session but never fires client-side, so other tabs keep rendering protected
  //   content until they happen to hit the network again. Do NOT simplify this back down
  //   to a single call — that's the regression e2e/logout.spec.ts exists to catch.
  //
  // Server call goes first so it's the one that lands even if the browser call fails.
  // The browser client's own signOut() then races an already-revoked session — GoTrue
  // ignores the resulting 401/403/404 from its own admin.signOut() call and still removes
  // the local session and emits SIGNED_OUT — so the ordering is harmless.
  async function handleSignOut(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      const res = await fetch('/api/auth/sign-out', { method: 'POST' })
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
      if (!res.ok) throw new Error('sign-out request failed')
      window.location.assign('/auth/sign-in')
    } catch {
      // Something in the client-side path failed (network blip, GoTrue error) — fall
      // back to a real form submission rather than leaving the button dead. This is the
      // exact same request the no-JS path below performs natively, before hydration or
      // with JS disabled: <form action="/api/auth/sign-out" method="POST">.
      signOutFormRef.current?.submit()
    }
  }

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

  if (loading) {
    return (
      <div className="app-screen app-screen-x">
        <p className="t-body">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="app-screen app-screen-x app-stack">
      <header className={styles.header}>
        <p className="t-kicker" style={{ marginBottom: 10 }}>Workspace control</p>
        <h1 className="t-headline">Settings</h1>
        <p className="t-body" style={{ marginTop: 8 }}>Manage your identity, organization, and account security in one place.</p>
      </header>

      {toast && (
        <div role="alert" aria-live="polite" className={styles.toast} data-variant={toast.type}>
          {toast.message}
        </div>
      )}

      {/* Profile section */}
      <Surface tier="feature">
        <h2 className="t-title" style={{ marginBottom: 16 }}>Profile</h2>
        <form onSubmit={handleSaveProfile} className="a-form">
          <div className="a-field">
            <label className="a-label" htmlFor="display_name">Display Name</label>
            <input
              id="display_name"
              className="a-input"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your display name"
              aria-label="Display name"
            />
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="practice_name">Practice Name</label>
            <input
              id="practice_name"
              className="a-input"
              type="text"
              value={practiceName}
              onChange={e => setPracticeName(e.target.value)}
              placeholder="Your practice name"
              aria-label="Practice name"
            />
          </div>
          <button type="submit" disabled={saving} className="a-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </Surface>

      {/* Organization & Compliance section */}
      <Surface tier="feature">
        <h2 className="t-title" style={{ marginBottom: 16 }}>Organization &amp; Compliance</h2>
        <form onSubmit={handleSaveOrg} className="a-form">
          <div className="a-field">
            <label className="a-label" htmlFor="org_name">Organization Name</label>
            <input
              id="org_name"
              className="a-input"
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Your organization name"
              aria-label="Organization name"
            />
          </div>

          <label htmlFor="covered_entity" className={styles.checkRow}>
            <input
              id="covered_entity"
              type="checkbox"
              checked={isCoveredEntity}
              onChange={e => setIsCoveredEntity(e.target.checked)}
            />
            <span className="t-body">
              This organization is a HIPAA covered entity
              <span className="a-help" style={{ display: 'block', marginTop: 4 }}>
                Turning this on requires a signed Business Associate Agreement before practitioner mode can be used.
              </span>
            </span>
          </label>

          <div className="a-field">
            <label className="a-label" htmlFor="baa_status">Business Associate Agreement (BAA) status</label>
            <select
              id="baa_status"
              className="a-select"
              value={baaStatus}
              onChange={e => setBaaStatus(e.target.value as 'not_required' | 'pending' | 'signed')}
              aria-label="BAA status"
            >
              <option value="not_required">Not required</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
            </select>
          </div>

          {baaStatus === 'signed' && (
            <div className="a-field">
              <label className="a-label" htmlFor="baa_signed_at">BAA signed date</label>
              <input
                id="baa_signed_at"
                className="a-input"
                type="date"
                value={baaSignedAt}
                onChange={e => setBaaSignedAt(e.target.value)}
                aria-label="BAA signed date"
              />
            </div>
          )}

          {isCoveredEntity && baaStatus !== 'signed' && (
            <p role="status" className={`t-body ${styles.baaWarning}`}>
              Practitioner mode is currently blocked for this organization until a signed BAA is recorded.
            </p>
          )}

          <button type="submit" disabled={orgSaving} className="a-primary">
            {orgSaving ? 'Saving...' : 'Save Organization'}
          </button>
          <p className="a-help">
            These compliance details are self-attested by you and control whether the BAA gate applies.
          </p>
        </form>
      </Surface>

      {/* Logo section */}
      <Surface tier="feature">
        <h2 className="t-title" style={{ marginBottom: 16 }}>Practice Logo</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Practice logo preview" className={styles.logoPreview} />
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
            className="a-secondary"
            style={{ alignSelf: 'flex-start' }}
          >
            {logoUploading ? 'Uploading...' : logoUrl ? 'Replace Logo' : 'Upload Logo'}
          </button>
          <p className="a-help">JPEG, PNG, or WebP. Shown on PDF reports.</p>
        </div>
      </Surface>

      {/* Password section */}
      <Surface tier="feature">
        <h2 className="t-title" style={{ marginBottom: 16 }}>Change Password</h2>
        <form onSubmit={handlePasswordChange} className="a-form">
          <div className="a-field">
            <label className="a-label" htmlFor="current_password">Current Password</label>
            <input
              id="current_password"
              className="a-input"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              aria-label="Current password"
            />
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="new_password">New Password</label>
            <input
              id="new_password"
              className="a-input"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
              aria-label="New password"
            />
          </div>
          <button type="submit" disabled={passwordSaving || !newPassword.trim()} className="a-primary">
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </Surface>

      {/* Sign out */}
      <form ref={signOutFormRef} action="/api/auth/sign-out" method="POST" onSubmit={handleSignOut}>
        <button type="submit" className={`a-quiet ${styles.signOut}`} style={{ color: 'var(--review)' }}>
          Sign Out
        </button>
      </form>
    </div>
  )
}
