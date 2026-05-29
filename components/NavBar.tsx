'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavBar() {
  const pathname = usePathname()
  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/clients', label: 'Clients' },
    { href: '/exercises', label: 'Exercises' },
    { href: '/settings', label: 'Settings' },
  ]
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
        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#6366F1' }}>Posture AI</span>
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
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
            }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
