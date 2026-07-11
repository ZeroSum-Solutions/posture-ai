'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import styles from './DashboardExperience.module.css'

type Assessment = {
  id: string
  overall_grade: string | null
  overall_score: number | null
  created_at: string
  client_id: string
  clients: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null
}

type Props = {
  clientCount: number
  weekAssessments: number
  recentAssessments: Assessment[]
}

const enter = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, delay, ease: [0.16, 1, 0.3, 1] as const },
})

function clientName(assessment: Assessment) {
  const client = assessment.clients
  if (!client) return 'Unknown Client'
  if (Array.isArray(client)) return client[0] ? `${client[0].first_name} ${client[0].last_name}` : 'Unknown Client'
  return `${client.first_name} ${client.last_name}`
}

function gradeTone(grade: string | null) {
  if (grade === 'S' || grade === 'A') return styles.gradeGood
  if (grade === 'B' || grade === 'C') return styles.gradeReview
  return styles.gradeAlert
}

export default function DashboardExperience({ clientCount, weekAssessments, recentAssessments }: Props) {
  const averageScore = recentAssessments.length
    ? Math.round(recentAssessments.reduce((sum, assessment) => sum + (assessment.overall_score ?? 0), 0) / recentAssessments.length)
    : null
  const pulse = recentAssessments.slice(0, 5).reverse().map((assessment, index) => ({
    x: 14 + index * 23,
    y: Math.max(15, 72 - (assessment.overall_score ?? 58) * 0.55),
  }))
  const pulseLine = pulse.length > 1 ? pulse.map(point => `${point.x},${point.y}`).join(' ') : '14,58 38,48 61,64 84,36 106,44'

  return (
    <div className={styles.page}>
      <motion.section className={styles.hero} {...enter()}>
        <div>
          <p className={styles.eyebrow}><span /> Practitioner console</p>
          <h1>Your movement practice, in focus.</h1>
          <p className={styles.heroCopy}>A calm place to capture a baseline, review what changed, and keep each next conversation clear.</p>
        </div>
        <Link href="/assessments/new" className={styles.primaryAction}>
          <span>New assessment</span><b aria-hidden="true">↗</b>
        </Link>
      </motion.section>

      <section className={styles.metrics} aria-label="Practice overview">
        <motion.article className={styles.metricCard} {...enter(0.05)}>
          <div className={styles.metricTop}><span>Active clients</span><i aria-hidden="true">01</i></div>
          <strong className="data-readout">{String(clientCount).padStart(2, '0')}</strong>
          <p>People in your current care view</p>
        </motion.article>
        <motion.article className={styles.metricCard} {...enter(0.1)}>
          <div className={styles.metricTop}><span>Completed this week</span><i aria-hidden="true">02</i></div>
          <strong className="data-readout">{String(weekAssessments).padStart(2, '0')}</strong>
          <p>Finished screening sessions</p>
        </motion.article>
        <motion.article className={`${styles.metricCard} ${styles.metricHighlight}`} {...enter(0.15)}>
          <div className={styles.metricTop}><span>Recent screen average</span><i aria-hidden="true">03</i></div>
          <strong className="data-readout">{averageScore === null ? '—' : averageScore}</strong>
          <p>{averageScore === null ? 'Appears after your first assessment' : 'Across your latest five screens'}</p>
        </motion.article>
      </section>

      <section className={styles.contentGrid}>
        <motion.article className={styles.pulseCard} {...enter(0.2)}>
          <header className={styles.panelHeader}>
            <div><span className={styles.panelKicker}>Assessment pulse</span><h2>Recent screening signal</h2></div>
            <span className={styles.liveTag}><i /> Live record</span>
          </header>
          <div className={styles.pulseGraphic} aria-label={recentAssessments.length ? `Recent screening average is ${averageScore}` : 'No screening data yet'}>
            <svg viewBox="0 0 120 86" role="img" aria-hidden="true" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pulseStroke" x1="0" x2="1"><stop stopColor="#FF8918" /><stop offset="0.56" stopColor="#DA4E24" /><stop offset="1" stopColor="#0098F3" /></linearGradient>
                <linearGradient id="pulseFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#0098F3" stopOpacity="0.26" /><stop offset="1" stopColor="#0098F3" stopOpacity="0" /></linearGradient>
              </defs>
              <path d="M0 72H120M0 50H120M0 28H120" className={styles.gridLine} />
              <path d={`M ${pulseLine} L 106,86 L 14,86 Z`} fill="url(#pulseFill)" />
              <polyline points={pulseLine} fill="none" stroke="url(#pulseStroke)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
              {pulse.map((point, index) => <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="2.6" className={styles.pulsePoint} style={{ animationDelay: `${index * 80}ms` }} />)}
            </svg>
            <div className={styles.pulseMeta}><span>Latest screens</span><b className="data-readout">{recentAssessments.length || '—'}</b></div>
          </div>
          <p className={styles.panelFoot}>Scores are screening signals, not a clinical conclusion.</p>
        </motion.article>

        <motion.article className={styles.quickStart} {...enter(0.25)}>
          <span className={styles.panelKicker}>Next move</span>
          <h2>Start with a clean baseline.</h2>
          <p>Guide a new capture with consent, camera checks, and a focused review in one flow.</p>
          <Link href="/assessments/new" className={styles.textAction}>Open capture <span aria-hidden="true">→</span></Link>
          <div className={styles.orbit} aria-hidden="true"><span /><i /></div>
        </motion.article>
      </section>

      <motion.section className={styles.activity} {...enter(0.3)}>
        <header className={styles.panelHeader}>
          <div><span className={styles.panelKicker}>Practice log</span><h2>Recent activity</h2></div>
          <Link href="/clients" className={styles.quietLink}>View clients <span aria-hidden="true">→</span></Link>
        </header>
        {recentAssessments.length > 0 ? (
          <ul className={styles.activityList}>
            {recentAssessments.map((assessment, index) => (
              <motion.li key={assessment.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: 0.32 + index * 0.045 }}>
                <Link href={`/assessments/${assessment.id}`}>
                  <span className={styles.activityIndex}>0{index + 1}</span>
                  <span className={styles.clientDetails}><b>{clientName(assessment)}</b><small>Assessment · {new Date(assessment.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></span>
                  <span className={styles.activityResult}>{assessment.overall_grade && <em className={gradeTone(assessment.overall_grade)}>Grade {assessment.overall_grade}</em>}<i aria-hidden="true">→</i></span>
                </Link>
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyState}><span>01</span><div><h3>No assessments yet</h3><p>Your first completed screen will appear here with its score and review path.</p></div><Link href="/assessments/new">Run a scan <span aria-hidden="true">→</span></Link></div>
        )}
      </motion.section>
    </div>
  )
}
