import Link from 'next/link'
import BrandMark from '@/components/BrandMark'
import styles from './MarketingHome.module.css'

const workflow = [
  ['01', 'Capture', 'Guide a client through a consistent, consent-led capture.'],
  ['02', 'Review', 'See the measurements that deserve a practitioner’s attention.'],
  ['03', 'Coach', 'Turn screening context into a prioritized movement routine.'],
]

const findings = [
  { label: 'Head & neck', note: 'Forward shift', value: '+4.2°', tone: 'review' },
  { label: 'Shoulders', note: 'Elevation', value: '+2.1°', tone: 'quiet' },
  { label: 'Trunk', note: 'Inclination', value: '+1.8°', tone: 'quiet' },
]

export function MarketingHome() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="Posture AI home">
            <BrandMark size={30} />
            Posture AI
          </Link>
          <nav className={styles.actions} aria-label="Marketing navigation">
            <Link href="/auth/sign-in" className={styles.signIn}>Sign in</Link>
            <Link href="/auth/sign-in" className={styles.headerCta}>Run a scan <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span /> Practitioner-led posture screening</p>
            <h1 id="hero-title">A clearer view of how your clients move.</h1>
            <p className={styles.heroBody}>Capture a baseline, review the signals that matter, and give every client a practical next step.</p>
            <div className={styles.ctas}>
              <Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture scan <span aria-hidden="true">↗</span></Link>
              <a href="#workflow" className={styles.secondaryButton}>See the workflow</a>
            </div>
            <div className={styles.heroProof}>
              <span>Built for movement professionals</span>
              <span>Explicit consent, every capture</span>
            </div>
          </div>

          <div className={styles.heroVisual} aria-label="Assessment product preview">
            <div className={styles.orbit} aria-hidden="true" />
            <article className={styles.previewWindow}>
              <div className={styles.previewTopbar}><span>Assessment overview</span><span className={styles.liveStatus}><i /> Ready for review</span></div>
              <div className={styles.previewBody}>
                <div className={styles.gradeCard}><p>Overall screen</p><strong>B</strong><span>Clear focus areas</span></div>
                <div className={styles.metricStack}>
                  <div className={styles.metric}><span>Capture quality</span><strong>92%</strong><i><b /></i></div>
                  <div className={styles.metric}><span>Priority areas</span><strong>03</strong><i><b /></i></div>
                </div>
              </div>
              <div className={styles.previewFindings}>
                {findings.map((finding) => <div className={styles.previewFinding} key={finding.label}><span className={finding.tone === 'review' ? styles.findingDotReview : styles.findingDot} /><p><b>{finding.label}</b><small>{finding.note}</small></p><strong>{finding.value}</strong></div>)}
              </div>
              <div className={styles.previewFooter}><span>Screening only · not a diagnosis</span><button type="button">Open report <span aria-hidden="true">→</span></button></div>
            </article>
            <div className={styles.floatingStat}><span>Baseline confidence</span><strong className="data-readout">0.92</strong><em>Verified capture</em></div>
          </div>
        </section>

        <section className={styles.trust} aria-label="Product principles">
          <span>Reliable capture guidance</span><span>Clear clinical boundaries</span><span>Progress you can revisit</span>
        </section>

        <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.sectionIntro}><p className={styles.kicker}><span /> From capture to coaching</p><h2 id="workflow-title">One calm workflow. A more useful conversation.</h2></div>
          <div className={styles.workflowGrid}>
            {workflow.map(([number, title, body]) => <article className={styles.step} key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p><i aria-hidden="true">↗</i></article>)}
          </div>
        </section>

        <section className={styles.signalSection} aria-labelledby="signal-title">
          <div className={styles.signalCopy}><p className={styles.kicker}><span /> Evidence, not noise</p><h2 id="signal-title">Make the next decision easier to see.</h2><p>Give measurements enough room to read. Keep the context close. Let a client leave with a focused plan instead of a dense, impersonal printout.</p><Link href="/auth/sign-in" className={styles.textLink}>Explore the assessment view <span aria-hidden="true">→</span></Link></div>
          <div className={styles.findingBoard}>
            <header><span>Priority findings</span><em>Sample screen</em></header>
            {findings.map((finding, index) => <article key={finding.label}><span className={styles.findingIndex}>0{index + 1}</span><div><h3>{finding.label}</h3><p>{finding.note}</p></div><strong className="data-readout">{finding.value}</strong><span className={finding.tone === 'review' ? styles.reviewChip : styles.quietChip}>{finding.tone === 'review' ? 'Review' : 'Monitor'}</span></article>)}
            <footer><span>Results are screening signals, not a clinical conclusion.</span><span>3 findings</span></footer>
          </div>
        </section>

        <section className={styles.coaching} aria-labelledby="coaching-title">
          <div className={styles.routinePanel}><div className={styles.routineHeader}><span>Today’s focus</span><strong>12 min</strong></div><h3>Build the routine around the finding.</h3>{['Thoracic extension reset', 'Hip flexor mobility', 'Glute bridge patterning'].map((item, index) => <div className={styles.routineItem} key={item}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p><i aria-hidden="true">↗</i></div>)}<div className={styles.routineBottom}><span>3 movements</span><button type="button">View routine</button></div></div>
          <div className={styles.coachingCopy}><p className={styles.kicker}><span /> A plan they can follow</p><h2 id="coaching-title">Screen once. Coach with intent.</h2><p>Posture AI connects a screening result to your clinical judgment. Use the exercise layer to explain the next step without overstating what a screen can tell you.</p></div>
        </section>

        <section className={styles.finalCta} aria-labelledby="cta-title"><p className={styles.kicker}><span /> See the baseline</p><h2 id="cta-title">Give every client a more useful starting point.</h2><p>Private capture, clear results, and a workflow designed for the practitioner in the room.</p><Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture scan <span aria-hidden="true">↗</span></Link></section>
      </main>
    </div>
  )
}
