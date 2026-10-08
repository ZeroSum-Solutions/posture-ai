'use client'
import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { finishBrowserSignOut } from '@/lib/auth/finish-sign-out'
import { synchronizeTrainingOfflineAuth } from '@/lib/training/offline'
import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { SurfaceButton } from '@/components/ui/Surface'
import { Skeleton } from '@/components/ui/Skeleton'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dialog } from '@/components/ui/Dialog'
import { Select } from '@/components/ui/Select'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import TopBar from '@/components/ui/TopBar'
import styles from './SettingsPage.module.css'

type Practitioner = {
  display_name: string | null
  practice_name: string | null
  logo_storage_path: string | null
}

type SheetKey = 'practice' | 'privacy' | 'legal' | 'help' | null

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0]!.charAt(0) + (parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '')).toUpperCase()
}

function readHapticsEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem('pa:haptics') !== 'off'
  } catch {
    return true
  }
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
  const [openSheet, setOpenSheet] = useState<SheetKey>(null)
  const [hapticsEnabled, setHapticsEnabled] = useState(readHapticsEnabled)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const [accountEmail, setAccountEmail] = useState('')

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/auth/sign-in'); return }
      setAccountEmail(user.email ?? '')
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
  // The ordering below is NOT "fire both, then check the response" — that was the bug.
  // /api/auth/sign-out can return 503 without revoking anything (see its own "does not
  // claim success when provider signout fails" test): the httpOnly cookie survives.
  // Firing the browser signOut() broadcast before checking res.ok told every other open
  // tab "session's gone" while it demonstrably was not. On a device that may be showing
  // PHI, that false-safety broadcast is the worse of our two failure modes — a session
  // that outlives its "signed out" UI is a PHI risk, whereas a tab that's merely slow to
  // notice a real sign-out is only a stale-UI risk (AuthSessionGuard already holds the
  // server as authoritative on the next request; the broadcast is a UX head start, not
  // the security boundary). So every ambiguous case below resolves in favor of NOT
  // broadcasting rather than risk lying about it:
  //
  //   - res.ok           -> server confirmed the session is revoked. Only now call the
  //                         browser client's signOut() to fire the real broadcast.
  //   - res not ok (503) -> server confirmed the session is STILL VALID. Never call
  //                         signOut() here; tell the user instead of lying to every tab.
  //   - fetch() throws    -> genuine network failure; we never learned whether the server
  //                         revoked anything, so fall back to the same native form POST
  //                         the no-JS path below performs. We still call signOut() first:
  //                         @supabase/auth-js's signOut() never throws, and only clears
  //                         local state + broadcasts when its own revoke call actually
  //                         succeeded or came back 401/403/404 (session already dead) —
  //                         a true network failure inside it resolves to
  //                         {error: AuthRetryableFetchError} and leaves local state and
  //                         the broadcast untouched (see _signOut()/admin.signOut() in
  //                         @supabase/auth-js). So this call can only ever broadcast
  //                         something true, even offline — it's a bonus catch for the
  //                         common case where our own same-origin fetch failed (blocked
  //                         extension, CORS misconfig) without the SDK's request failing
  //                         the same way.
  //
  // The visible row below is a `type="submit"` button inside this form for the no-JS
  // fallback (its action/method attributes POST directly with no JS at all), but its
  // onClick always prevents that default and opens a confirm Dialog instead — the
  // Dialog's own confirm button calls performSignOut() directly, never through a submit
  // event, so the native-fallback path and the JS-confirmed path can't double-fire.
  async function performSignOut() {
    let res: Response
    try {
      res = await fetch('/api/auth/sign-out', { method: 'POST' })
    } catch {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
      signOutFormRef.current?.submit()
      return
    }

    if (!res.ok) {
      showToast('error', 'Could not sign out. Please try again.')
      return
    }

    const supabase = createSupabaseBrowserClient()
    await finishBrowserSignOut({
      signOut: () => supabase.auth.signOut(),
      clearOfflineQueue: () => synchronizeTrainingOfflineAuth({ kind: 'signed_out' }),
      navigate: () => window.location.assign('/auth/sign-in'),
    })
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

  function handleHapticsChange(enabled: boolean) {
    setHapticsEnabled(enabled)
    try {
      if (enabled) localStorage.removeItem('pa:haptics')
      else localStorage.setItem('pa:haptics', 'off')
    } catch {
      /* private mode / quota — the switch still reflects the chosen state this session */
    }
  }

  if (loading) {
    return (
      <div className="app-screen">
        <TopBar title="Profile" subtitle=" " />
        <div className={`app-screen-x ${styles.page}`} role="status" aria-busy="true">
          <span className="sr-only">Loading settings…</span>
          <div className={styles.heroSkeleton} aria-hidden="true">
            <Skeleton shape="avatar" style={{ width: 60, height: 60, borderRadius: 'var(--r-full)' }} />
            <div className={styles.skeletonText}>
              <Skeleton shape="line" style={{ width: '62%', height: 22 }} />
              <Skeleton shape="line" style={{ width: '40%', height: 14 }} />
            </div>
          </div>
          <div aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={styles.skeletonRow}>
                <Skeleton shape="line" style={{ width: `${36 + ((index * 13) % 24)}%`, height: 16 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const profileName = displayName || practitioner?.display_name || 'Your profile'
  const rows: Array<{ key: Exclude<SheetKey, null>; title: string; detail: string; icon: IconName; testId: string }> = [
    { key: 'privacy', title: 'Privacy & data', detail: 'Organization, BAA and password', icon: 'shield-check-linear', testId: 'settings-privacy' },
    { key: 'legal', title: 'Legal', detail: 'Privacy Policy and Terms of Use', icon: 'clipboard-check-linear', testId: 'settings-legal' },
    { key: 'help', title: 'Help', detail: 'Account and practice support', icon: 'info-circle-linear', testId: 'settings-help' },
  ]

  return (
    <div className="app-screen">
      {/* The subtitle (the signed-in account) also keeps the large title's
          scroll sentinel clear of the bar, so it does not start collapsed. */}
      <TopBar title="Profile" subtitle={accountEmail || ' '} />

      {toast && (
        <div className={styles.toastWrap}>
          <Banner variant={toast.type === 'success' ? 'success' : 'error'}>{toast.message}</Banner>
        </div>
      )}

      <div className={`app-screen-x ${styles.page}`}>
        {/* Hero: the practice identity as ONE tappable object (identity +
            chevron) that opens Practice info — no inner link row, so the card
            reads as the single action it is. */}
        <SurfaceButton
          tier="feature"
          className={styles.hero}
          innerClassName={styles.heroBody}
          sheen
          onClick={() => setOpenSheet('practice')}
          aria-label={`Practice info — ${profileName}${practiceName ? `, ${practiceName}` : ''}`}
          data-testid="settings-practice-info"
        >
          <span className={styles.heroInner}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className={styles.heroLogo} />
            ) : (
              <span className={styles.heroInitials} aria-hidden="true">{initialsOf(profileName)}</span>
            )}
            <span className={styles.heroText}>
              <span className={`t-title ${styles.heroName}`}>{profileName}</span>
              <span className={`t-label ${styles.heroMeta}`}>
                {practiceName ? `${practiceName} · Practice info` : 'Practice info'}
              </span>
            </span>
            <Icon name="alt-arrow-right-linear" size={20} className={styles.heroChevron} />
          </span>
        </SurfaceButton>

        <section className={styles.section} aria-labelledby="settings-account">
          <h2 id="settings-account" className="t-micro">Account</h2>
          <ul className={styles.list}>
            {rows.map((row, index) => (
              <li key={row.key} className={styles.item} style={{ '--i': index } as CSSProperties}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => setOpenSheet(row.key)}
                  data-testid={row.testId}
                >
                  <span className={styles.rowIcon} aria-hidden="true"><Icon name={row.icon} size={22} /></span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{row.title}</span>
                    <span className="t-label">{row.detail}</span>
                  </span>
                  <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="settings-device">
          <h2 id="settings-device" className="t-micro">This device</h2>
          <Switch
            label="Haptics"
            description="A light tap when you press, snap or capture"
            checked={hapticsEnabled}
            onChange={(e) => handleHapticsChange(e.target.checked)}
          />
        </section>

        {/* A real <form>, not a styled row: the action/method attributes are
            the no-JS fallback (a direct native POST), and the submit button's
            onClick always prevents that default to open the confirm Dialog
            instead — see performSignOut's comment above. */}
        <form ref={signOutFormRef} action="/api/auth/sign-out" method="POST" className={styles.signOutForm}>
          <button
            type="submit"
            className={styles.signOut}
            onClick={(e) => { e.preventDefault(); setShowSignOutConfirm(true) }}
          >
            Sign Out
          </button>
        </form>
      </div>

      <Dialog
        open={showSignOutConfirm}
        onOpenChange={setShowSignOutConfirm}
        title="Sign out?"
        description="You'll need to sign in again to continue."
        confirm={{
          label: 'Yes, sign out',
          tone: 'danger',
          onConfirm: () => {
            setShowSignOutConfirm(false)
            void performSignOut()
          },
        }}
      />

      <Sheet
        open={openSheet === 'practice'}
        onOpenChange={(open) => !open && setOpenSheet(null)}
        title="Practice info"
        detents={['medium', 'large']}
        footer={
          <Button type="submit" form="practice-info-form" variant="primary" size="lg" block loading={saving}>
            Save changes
          </Button>
        }
      >
        <form onSubmit={handleSaveProfile} className="app-stack" id="practice-info-form">
          <TextField
            id="display_name"
            label="Display name"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Your display name"
          />
          <TextField
            id="practice_name"
            label="Practice name"
            type="text"
            value={practiceName}
            onChange={e => setPracticeName(e.target.value)}
            placeholder="Your practice name"
          />
          <div className="app-stack" style={{ gap: 'var(--s-12)' }}>
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
            <Button
              type="button"
              variant="secondary"
              loading={logoUploading}
              onClick={() => logoInputRef.current?.click()}
              style={{ alignSelf: 'flex-start' }}
            >
              {logoUrl ? 'Replace logo' : 'Upload logo'}
            </Button>
            <p className="t-footnote" style={{ color: 'var(--text-3)' }}>JPEG, PNG, or WebP. Shown on PDF reports.</p>
          </div>
        </form>
      </Sheet>

      <Sheet
        open={openSheet === 'privacy'}
        onOpenChange={(open) => !open && setOpenSheet(null)}
        title="Privacy & data"
        detents={['medium', 'large']}
      >
        <div className="app-stack">
          <form onSubmit={handleSaveOrg} className="app-stack" id="org-settings-form">
            <TextField
              id="org_name"
              label="Organization name"
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Your organization name"
            />

            <Checkbox
              id="covered_entity"
              checked={isCoveredEntity}
              onChange={e => setIsCoveredEntity(e.target.checked)}
              label={
                <>
                  This organization is a HIPAA covered entity
                  <span className="t-footnote" style={{ display: 'block', marginTop: 'var(--s-4)', color: 'var(--text-3)' }}>
                    Turning this on requires a signed Business Associate Agreement before practitioner mode can be used.
                  </span>
                </>
              }
            />

            <Select
              id="baa_status"
              label="Business Associate Agreement (BAA) status"
              value={baaStatus}
              onChange={e => setBaaStatus(e.target.value as 'not_required' | 'pending' | 'signed')}
            >
              <option value="not_required">Not required</option>
              <option value="pending">Pending</option>
              <option value="signed">Signed</option>
            </Select>

            {baaStatus === 'signed' && (
              <TextField
                id="baa_signed_at"
                label="BAA signed date"
                type="date"
                value={baaSignedAt}
                onChange={e => setBaaSignedAt(e.target.value)}
              />
            )}

            {isCoveredEntity && baaStatus !== 'signed' && (
              <Banner variant="warn">
                Practitioner mode is currently blocked for this organization until a signed BAA is recorded.
              </Banner>
            )}

            <Button type="submit" variant="primary" loading={orgSaving}>
              Save organization
            </Button>
            <p className="t-footnote" style={{ color: 'var(--text-3)' }}>
              These compliance details are self-attested by you and control whether the BAA gate applies.
            </p>
          </form>

          <form onSubmit={handlePasswordChange} className={`app-stack ${styles.sheetSection}`} id="password-change-form">
            <p className="t-headline">Change password</p>
            <TextField
              id="current_password"
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
            />
            <TextField
              id="new_password"
              label="New password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
              autoComplete="new-password"
            />
            <Button type="submit" variant="secondary" loading={passwordSaving}>
              Update Password
            </Button>
          </form>
        </div>
      </Sheet>

      <Sheet
        open={openSheet === 'legal'}
        onOpenChange={(open) => !open && setOpenSheet(null)}
        title="Legal"
      >
        <ul className={styles.list} aria-label="Legal documents">
          <li className={styles.item}>
            <Link href="/privacy" className={styles.row}>
              <span className={styles.rowText}><span className={styles.rowTitle}>Privacy Policy</span></span>
              <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
            </Link>
          </li>
          <li className={styles.item}>
            <Link href="/terms" className={styles.row}>
              <span className={styles.rowText}><span className={styles.rowTitle}>Terms of Use</span></span>
              <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
            </Link>
          </li>
        </ul>
      </Sheet>

      <Sheet
        open={openSheet === 'help'}
        onOpenChange={(open) => !open && setOpenSheet(null)}
        title="Help"
      >
        <p className="t-body" style={{ color: 'var(--text-2)' }}>
          Contact your beta administrator for help with your account or practice settings.
        </p>
      </Sheet>
    </div>
  )
}
