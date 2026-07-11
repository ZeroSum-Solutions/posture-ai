'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import BrandMark from '@/components/BrandMark'

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/exercises', label: 'Exercises' },
  { href: '/muscles', label: 'Muscles' },
  { href: '/settings', label: 'Settings' },
]

export default function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const isAuthPage = pathname?.startsWith('/auth') || pathname?.startsWith('/onboarding')
  const isPublicDocument = pathname === '/privacy' || pathname === '/terms' || pathname?.startsWith('/consent/') || pathname?.startsWith('/s/')
  if (pathname === '/' || isAuthPage || isPublicDocument) return null

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/auth/sign-in')
    router.refresh()
    setSigningOut(false)
  }

  const linkStyle = (href: string): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    textDecoration: 'none',
    color: pathname?.startsWith(href) ? 'var(--text-primary)' : 'var(--text-secondary)',
    background: pathname?.startsWith(href) ? 'var(--surface-strong)' : 'transparent',
    transition: 'background var(--duration-hover) var(--ease-standard), color var(--duration-hover) var(--ease-standard)',
  })

  return (
    <nav
      aria-label="Application navigation"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        margin: '12px auto 0', padding: '6px 8px 6px 14px', width: 'min(1200px, calc(100% - 32px))',
        minHeight: '58px', background: 'rgba(18, 22, 20, 0.84)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '14px', backdropFilter: 'blur(14px)', position: 'sticky', top: '12px', zIndex: 100,
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.2)',
      }}
    >
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', minHeight: '44px', color: 'var(--text-primary)', fontSize: '0.94rem', fontWeight: 700, letterSpacing: '-0.03em', textDecoration: 'none', whiteSpace: 'nowrap' }}>
        <BrandMark size={26} />
        Posture AI
      </Link>

      {!isAuthPage && <div className="nav-desktop" style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>{links.map((link) => <Link key={link.href} href={link.href} style={linkStyle(link.href)}>{link.label}</Link>)}</div>}

      {!isAuthPage && (
        <button onClick={handleSignOut} disabled={signingOut} className="nav-desktop" style={{ padding: '8px 12px', borderRadius: '8px', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', cursor: signingOut ? 'not-allowed' : 'pointer', font: 'inherit', fontSize: '0.825rem', fontWeight: 600, opacity: signingOut ? 0.6 : 1 }}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      )}

      {!isAuthPage && (
        <button onClick={() => setOpen(!open)} className="nav-hamburger" aria-label="Toggle navigation menu" aria-expanded={open} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', padding: '8px', display: 'none', gap: '4px', flexDirection: 'column', justifyContent: 'center' }}>
          {[0, 1, 2].map((line) => <span key={line} style={{ display: 'block', width: '18px', height: '2px', background: open ? 'var(--brand)' : 'var(--text-secondary)', borderRadius: '2px' }} />)}
        </button>
      )}

      {!isAuthPage && open && (
        <div className="nav-mobile-menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, display: 'none', flexDirection: 'column', gap: '4px', padding: '8px', background: 'rgba(18, 22, 20, 0.98)', border: '1px solid var(--border)', borderRadius: '14px', boxShadow: '0 20px 42px rgba(0,0,0,0.32)' }}>
          {links.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)} style={linkStyle(link.href)}>{link.label}</Link>)}
          <button onClick={() => { setOpen(false); handleSignOut() }} style={{ padding: '8px 12px', borderRadius: '8px', background: 'transparent', border: 0, color: 'var(--text-secondary)', cursor: 'pointer', font: 'inherit', fontSize: '0.875rem', fontWeight: 600, textAlign: 'left' }}>Sign out</button>
        </div>
      )}

      <style>{`@media (max-width: 760px) { .nav-desktop { display: none !important; } .nav-hamburger { display: flex !important; } .nav-mobile-menu { display: flex !important; } }`}</style>
    </nav>
  )
}
