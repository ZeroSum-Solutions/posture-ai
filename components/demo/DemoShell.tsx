'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import styles from './DemoShell.module.css'

const destinations = [
  { href: '/demo', label: 'Overview', symbol: '◉' },
  { href: '/demo/scan', label: 'Scan', symbol: '⌖' },
  { href: '/demo/workouts', label: 'Workouts', symbol: '↗' },
]

export default function DemoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/demo" className={styles.brand}>posture<span>ai</span></Link>
        <span className={styles.badge}>Prototype</span>
      </header>
      <div className={styles.content}>{children}</div>
      <footer className={styles.footer}>Your scans and workouts stay in this browser. Screening support, not a diagnosis.</footer>
      <nav className={styles.nav} aria-label="Prototype navigation">
        {destinations.map(({ href, label, symbol }) => {
          const active = href === '/demo' ? pathname === href : pathname?.startsWith(href)
          return <Link href={href} key={href} aria-current={active ? 'page' : undefined}>
            <span aria-hidden="true">{symbol}</span><span>{label}</span>
          </Link>
        })}
      </nav>
    </div>
  )
}
