'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export default function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/clients', label: 'Clients' },
    { href: '/exercises', label: 'Exercises' },
    { href: '/muscles', label: 'Muscles' },
    { href: '/settings', label: 'Settings' },
  ]

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/auth/sign-in')
    router.refresh()
    setSigningOut(false)
  }

  const isAuthPage = pathname?.startsWith('/auth') || pathname?.startsWith('/onboarding')

  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      height: '56px',
      background: '#161618',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      position: 'sticky',
      top: '0',
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#6366F1', whiteSpace: 'nowrap' }}>Posture AI</span>
      </div>

      {/* Desktop nav links */}
      {!isAuthPage && (
        <div style={{ display: 'flex', gap: '4px' }} className="nav-desktop">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 500,
                textDecoration: 'none',
                color: pathname?.startsWith(l.href) ? '#F5F5F5' : '#A1A1AA',
                background: pathname?.startsWith(l.href) ? 'rgba(99,102,241,0.12)' : 'transparent',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}

      {/* Sign out button (desktop, only on protected pages) */}
      {!isAuthPage && (
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="nav-desktop"
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#A1A1AA',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: signingOut ? 'not-allowed' : 'pointer',
            opacity: signingOut ? 0.6 : 1,
            minHeight: '36px',
          }}
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      )}

      {/* Mobile hamburger button */}
      {!isAuthPage && (
        <button
          onClick={() => setOpen(!open)}
          className="nav-hamburger"
          aria-label="Toggle menu"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            display: 'none',
            flexDirection: 'column',
            gap: '5px',
            minWidth: '44px',
            minHeight: '44px',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ display: 'block', width: '22px', height: '2px', background: open ? '#6366F1' : '#A1A1AA', borderRadius: '2px' }} />
          <span style={{ display: 'block', width: '22px', height: '2px', background: open ? '#6366F1' : '#A1A1AA', borderRadius: '2px' }} />
          <span style={{ display: 'block', width: '22px', height: '2px', background: open ? '#6366F1' : '#A1A1AA', borderRadius: '2px' }} />
        </button>
      )}

      {/* Mobile dropdown menu */}
      {!isAuthPage && open && (
        <div
          className="nav-mobile-menu"
          style={{
            position: 'absolute',
            top: '56px',
            left: 0,
            right: 0,
            background: '#161618',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            display: 'none',
            flexDirection: 'column',
            padding: '8px 16px 16px',
            zIndex: 99,
          }}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: 500,
                textDecoration: 'none',
                color: pathname?.startsWith(l.href) ? '#F5F5F5' : '#A1A1AA',
                background: pathname?.startsWith(l.href) ? 'rgba(99,102,241,0.12)' : 'transparent',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                marginBottom: '4px',
              }}
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={() => { setOpen(false); handleSignOut(); }}
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 500,
              textDecoration: 'none',
              color: '#A1A1AA',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              marginBottom: '4px',
            }}
          >
            Sign out
          </button>
        </div>
      )}

      <style>{`@media (max-width: 600px) { .nav-desktop { display: none !important; } .nav-hamburger { display: flex !important; } .nav-mobile-menu { display: flex !important; } }`}</style>
    </nav>
  )
}
