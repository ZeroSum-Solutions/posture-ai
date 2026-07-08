import Link from 'next/link'
import { Source_Serif_4 } from 'next/font/google'
import { PointCloudFigure } from './PointCloudFigure'
import styles from './MarketingHome.module.css'

const serifItalic = Source_Serif_4({
  subsets: ['latin'],
  style: ['italic'],
  weight: ['400'],
  display: 'swap',
})

const steps = [
  {
    number: '01',
    title: 'Scan',
    body: 'Identify alignment drivers. Map your baseline against clinical reference angles in seconds.',
  },
  {
    number: '02',
    title: 'Plan',
    body: 'Corrective routine. Follow a daily, prioritized sequence targeting the muscular drivers of your posture.',
  },
  {
    number: '03',
    title: 'Retest',
    body: 'Measure the delta. Run a follow-up scan to visualize structural progress over time.',
  },
]

const domains = [
  {
    name: 'Head & neck',
    grade: 'D',
    percentile: '18th percentile',
    signal: 'Forward head posture',
    degrees: '+4.2',
    meaning: 'Mild anterior shift. Increases cervical load and upper trapezius tension.',
    action: 'Deep neck flexor activation.',
    sample: true,
  },
  {
    name: 'Shoulders',
    grade: 'C',
    percentile: '44th percentile',
    signal: 'Shoulder elevation',
    degrees: '+2.1',
    meaning: 'Asymmetry can bias neck mechanics and rib position during loaded movement.',
    action: 'Serratus wall slide sequence.',
  },
  {
    name: 'Trunk',
    grade: 'B',
    percentile: '62nd percentile',
    signal: 'Trunk inclination',
    degrees: '+1.8',
    meaning: 'Slight lateral shift. Monitor under fatigue and prolonged standing.',
    action: 'Lateral line breathing drill.',
  },
  {
    name: 'Pelvis',
    grade: 'C',
    percentile: '49th percentile',
    signal: 'Pelvic tilt',
    degrees: '+3.5',
    meaning: 'Anterior bias may increase lumbar extension demand during gait and squats.',
    action: 'Hip flexor mobility plus glute bridge.',
  },
  {
    name: 'Knees',
    grade: 'B',
    percentile: '68th percentile',
    signal: 'Knee valgus drift',
    degrees: '+1.4',
    meaning: 'Low asymmetry. Maintain control as loading volume increases.',
    action: 'Split squat tracking rehearsal.',
  },
]

const routineItems = [
  'Deep neck flexor activation',
  'Thoracic extension reset',
  'Hip flexor mobility',
  'Glute bridge patterning',
]

export function MarketingHome() {
  return (
    <div className={styles.page}>
      <header className={styles.marketingHeader} aria-label="Posture AI marketing header">
        <div className={styles.headerShell}>
          <Link href="/" className={styles.brandLink} aria-label="Posture AI home">
            <img src="/icon.svg" alt="" width="26" height="26" className={styles.brandMark} />
            <span>Posture AI</span>
          </Link>
          <nav className={styles.headerActions} aria-label="Marketing navigation">
            <Link href="/auth/sign-in" className={styles.signInLink}>Sign in</Link>
            <Link href="/auth/sign-in" className={styles.headerCta}>Run scan</Link>
          </nav>
        </div>
      </header>

      <section className={`${styles.container} ${styles.hero}`} aria-label="Outcome hero">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Clinical posture screening</p>
          <h1>Movement, measured.</h1>
          <p className={styles.heroBody}>
            See what&apos;s pulling your posture out of alignment &mdash; and fix it with a plan built for your body.
          </p>
          <div className={styles.ctaGroup}>
            <Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture scan</Link>
            <a href="#sample-report" className={styles.secondaryButton}>See a sample report</a>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <PointCloudFigure />
        </div>
      </section>

      <section className={`${styles.container} ${styles.trustStrip}`} aria-label="Trust signals">
        <span>Pose estimation <span aria-hidden="true">&middot;</span> MediaPipe BlazePose</span>
        <span>Clinician-reviewed exercise &amp; muscle content</span>
        <span>Explicit consent before every capture</span>
      </section>

      <section className={`${styles.container} ${styles.stepsSection}`} aria-label="Signal to plan">
        {steps.map((step) => (
          <article className={styles.step} key={step.number}>
            <span className={styles.stepNumber}>{step.number}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
          </article>
        ))}
      </section>

      <section className={`${styles.container} ${styles.domainSection}`} aria-label="Body domains">
        <div className={styles.domainIntro}>
          <span className={styles.verticalRule} aria-hidden="true" />
          <h2>The body domains</h2>
        </div>
        <div className={styles.domainCards}>
          {domains.map((domain) => (
            <article className={styles.domainCard} key={domain.name}>
              <div className={domain.grade === 'D' ? styles.gradeTileWarning : styles.gradeTile}>
                <strong>{domain.grade}</strong>
                <span>{domain.percentile}</span>
              </div>
              <div className={styles.domainContent}>
                <div className={styles.domainTopline}>
                  <h3>{domain.name}</h3>
                  {domain.sample ? <span className={styles.sampleLabel}>SAMPLE DATA</span> : null}
                </div>
                <p>
                  <span>Signal</span>
                  {domain.signal} <strong>{domain.degrees}&deg;</strong>
                </p>
                <p>
                  <span>Meaning</span>
                  {domain.meaning}
                </p>
                <p>
                  <span>Next action</span>
                  {domain.action}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.container} ${styles.progressSection}`} aria-label="Progress proof">
        <p className={`${serifItalic.className} ${styles.pullQuote}`}>A baseline is only useful if it moves.</p>
        <h2>Visualizing the delta.</h2>
        <p>
          Progress isn&apos;t a feeling. It&apos;s a measurable shift in resting alignment. Track adherence
          streaks and watch priority angles return to optimal ranges.
        </p>
        <div className={styles.deltaTile} aria-label="Sample progress data">
          <div>
            <span className={styles.sampleLabel}>SAMPLE DATA</span>
            <p>Trunk inclination <span aria-hidden="true">&middot;</span> since 22 May</p>
          </div>
          <strong>-3.1&deg;</strong>
          <div className={styles.riskBar} aria-hidden="true">
            <span />
          </div>
        </div>
      </section>

      <section className={`${styles.container} ${styles.coachingSection}`} aria-label="Coaching layer">
        <div className={styles.routinePanel} aria-label="Daily routine preview">
          <div className={styles.routineHeader}>
            <span>Daily routine</span>
            <strong>12 min</strong>
          </div>
          <div className={styles.routineStack}>
            {routineItems.map((item, index) => (
              <div className={styles.routineItem} key={item}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
          <div className={styles.completeButton} aria-hidden="true">Complete routine</div>
        </div>
        <div className={styles.coachingCopy}>
          <span className={styles.featureLabel}>Targeted activation protocols</span>
          <h2>The corrective engine as your daily guide.</h2>
          <p>
            Turn your screening results into an actionable routine. With clinician-reviewed education
            boundaries, you know exactly what to stretch, what to strengthen, and when a finding requires
            professional referral.
          </p>
        </div>
      </section>

      <section id="sample-report" className={styles.reportBand} aria-label="Sample report deep-dive">
        <div className={`${styles.container} ${styles.reportGrid}`}>
          <div className={styles.reportCopy}>
            <h2>Clinical-grade reporting, generated in seconds.</h2>
            <p>
              A report that looks like it came from a clinic rig. Hand your clients a comprehensive,
              printed breakdown of their structural baselines.
            </p>
          </div>
          <article className={styles.reportCard} aria-label="Sample report preview">
            <div className={styles.reportTop}>
              <span>Posture screen summary</span>
              <strong>Grade B</strong>
            </div>
            <div className={styles.reportRows}>
              <p><span>Head &amp; neck</span><strong>Forward head posture +4.2&deg;</strong></p>
              <p><span>Trunk</span><strong>Inclination -3.1&deg; delta</strong></p>
              <p><span>Plan</span><strong>4 priority exercises</strong></p>
            </div>
            <p className={styles.reportDisclaimer}>Screening purposes only. Not a medical diagnosis.</p>
          </article>
        </div>
      </section>

      <section className={`${styles.container} ${styles.finalCta}`} aria-label="Final call to action">
        <h2>Run your <span>first</span> posture scan.</h2>
        <Link href="/auth/sign-in" className={styles.primaryButton}>Run a posture scan</Link>
        <p>No credit card required. On-device processing keeps your landmarks private.</p>
      </section>
    </div>
  )
}
