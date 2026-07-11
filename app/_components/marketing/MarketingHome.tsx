import Link from 'next/link'
import BrandMark from '@/components/BrandMark'
import styles from './MarketingHome.module.css'

const workflow = [
  ['01', 'Capture', 'Guide a consistent, consent-led capture.'],
  ['02', 'Review', 'See the measurements and focus areas that deserve your attention.'],
  ['03', 'Coach', 'Turn the screen into a focused movement routine and a clearer client conversation.'],
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
            <Link href="/auth/sign-in" className={styles.headerCta}>Run a screen <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy} data-motion="left" data-motion-order="0">
            <p className={styles.kicker}><span /> Built for movement professionals</p>
            <h1 id="hero-title">See what to coach next.</h1>
            <p className={styles.heroBody}>Capture a client baseline, review the movement signals that deserve attention, and leave every session with a focused next step.</p>
            <div className={styles.ctas}>
              <Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture screen <span aria-hidden="true">↗</span></Link>
              <a href="#workflow" className={styles.secondaryButton}>See the workflow</a>
            </div>
            <div className={styles.heroProof}>
              <span>Private capture</span>
              <span>Explicit consent</span>
              <span>Screening-only guidance</span>
            </div>
          </div>

          <div className={styles.heroVisual} aria-label="Assessment product preview" data-motion="right" data-motion-order="1">
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

        <section className={styles.trust} aria-label="Product principles" data-motion="rise">
          <span>Consistent capture</span><span>Clear screening signals</span><span>Focused next steps</span>
        </section>

        <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.sectionIntro} data-motion="rise"><p className={styles.kicker}><span /> From capture to coaching</p><h2 id="workflow-title">A clearer baseline changes the conversation.</h2></div>
          <div className={styles.workflowGrid}>
            {workflow.map(([number, title, body], index) => <article className={styles.step} key={number} data-motion="rise" data-motion-order={index}><span>{number}</span><h3>{title}</h3><p>{body}</p><i aria-hidden="true">↗</i></article>)}
          </div>
        </section>

        <section className={styles.signalSection} aria-labelledby="signal-title">
          <div className={styles.signalCopy} data-motion="left"><p className={styles.kicker}><span /> Clear findings</p><h2 id="signal-title">Make the next decision easier to see.</h2><p>Give every client a report you can review together. Clear focus areas and readable measurements keep the conversation grounded in your professional judgment.</p><Link href="/auth/sign-in" className={styles.textLink}>Explore the assessment view <span aria-hidden="true">→</span></Link></div>
          <div className={styles.findingBoard} data-motion="right" data-motion-order="1">
            <header><span>Priority findings</span><em>Sample screen</em></header>
            {findings.map((finding, index) => <article key={finding.label}><span className={styles.findingIndex}>0{index + 1}</span><div><h3>{finding.label}</h3><p>{finding.note}</p></div><strong className="data-readout">{finding.value}</strong><span className={finding.tone === 'review' ? styles.reviewChip : styles.quietChip}>{finding.tone === 'review' ? 'Review' : 'Monitor'}</span></article>)}
            <footer><span>Results are screening signals, not a clinical conclusion.</span><span>3 findings</span></footer>
          </div>
        </section>

        <section className={styles.coaching} aria-labelledby="coaching-title">
          <div className={styles.routinePanel} data-motion="left"><div className={styles.routineHeader}><span>Today’s focus</span><strong>12 min</strong></div><h3>Build the routine around the finding.</h3>{['Thoracic extension reset', 'Hip flexor mobility', 'Glute bridge patterning'].map((item, index) => <div className={styles.routineItem} key={item}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p><i aria-hidden="true">↗</i></div>)}<div className={styles.routineBottom}><span>3 movements</span><button type="button">View routine</button></div></div>
          <div className={styles.coachingCopy} data-motion="right" data-motion-order="1"><p className={styles.kicker}><span /> A plan they can follow</p><h2 id="coaching-title">Screen once. Coach with intent.</h2><p>Use a client’s baseline to shape the next conversation and build a routine they can follow between sessions.</p></div>
        </section>

        <section className={styles.finalCta} aria-labelledby="cta-title" data-motion="scale"><p className={styles.kicker}><span /> Start with a baseline</p><h2 id="cta-title">Give every client a better starting point.</h2><p>Private capture and clear screening signals for a more focused way to coach movement.</p><Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture screen <span aria-hidden="true">↗</span></Link></section>
      </main>
    </div>
  )
}
