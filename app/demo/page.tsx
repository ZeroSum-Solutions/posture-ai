'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DEMO_SCAN_EVENT, loadDemoScan } from '@/lib/demo/scan-store'
import type { DemoScan } from '@/lib/demo/scan'
import styles from './page.module.css'

export default function DemoHome() {
  const [scan, setScan] = useState<DemoScan | null>(null)
  useEffect(() => {
    const refresh = () => setScan(loadDemoScan())
    refresh()
    window.addEventListener(DEMO_SCAN_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(DEMO_SCAN_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const findings = scan?.result.findings.filter(finding => finding.reliable && finding.zone !== 'maintain') ?? []
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>YOUR MOVEMENT, UNDERSTOOD</p>
        <h1>A little insight.<br />A better way to move.</h1>
        <p className={styles.intro}>Turn your posture scan into a workout that fits your body, your space, and your day.</p>
        <Link href={scan ? '/demo/workouts' : '/demo/scan'} className={styles.primary}>{scan ? 'Build my workout' : 'Start my scan'} <span aria-hidden="true">↗</span></Link>
      </section>

      <section className={styles.grid} aria-label="Your workspace">
        <Link href="/demo/scan" className={styles.card}>
          <span className={styles.number}>01 / UNDERSTAND</span>
          <div className={styles.scanArt} aria-hidden="true">
            <svg viewBox="0 0 180 180" fill="none"><path d="M20 50V20H50M130 20H160V50M160 130V160H130M50 160H20V130" stroke="currentColor" strokeWidth="1.5"/><circle cx="90" cy="49" r="13" stroke="currentColor"/><path d="M62 86L90 70L118 86M90 70V112M62 86L53 116M118 86L127 116M90 112L72 152M90 112L108 152" stroke="currentColor" strokeWidth="2"/><path d="M30 101H150" stroke="var(--maintain)"/><circle cx="90" cy="101" r="4" fill="var(--maintain)"/></svg>
          </div>
          <h2>{scan ? 'Your latest scan' : 'Meet your posture'}</h2>
          <p>{scan ? `${scan.source === 'sample' ? 'Sample scan' : 'Personal scan'} · ${findings.length} movement focus areas. Review your views and findings.` : 'Use your camera, upload front and side photos, or explore a repeatable sample scan.'}</p>
          <span className={styles.cardAction}>{scan ? 'View findings' : 'Explore scanning'} <span aria-hidden="true">→</span></span>
        </Link>
        <Link href="/demo/workouts" className={styles.card}>
          <span className={styles.number}>02 / MOVE</span>
          <div className={styles.workoutArt} aria-hidden="true"><span>10</span><span>15</span><span>20</span><small>MINUTES FOR YOU</small></div>
          <h2>Your plan. Your pace.</h2>
          <p>Let AI select movements from your scan findings. Adjust your plan, save it, and follow along one exercise at a time.</p>
          <span className={styles.cardAction}>Open workouts <span aria-hidden="true">→</span></span>
        </Link>
      </section>
      <section className={styles.note}>
        <span className={styles.dot} aria-hidden="true" />
        <p>Built around you. Photos are analyzed on your device. Only movement findings and workout preferences are sent when you choose AI.</p>
      </section>
    </main>
  )
}
