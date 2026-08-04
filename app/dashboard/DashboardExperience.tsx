import Link from 'next/link'
import { Chip, DeltaChip, GradeChip } from '@/components/array/Chip'
import Icon from '@/components/array/Icon'
import { Surface, SurfaceLink } from '@/components/array/Surface'
import { tone } from '@/components/array/severity'
import type { TodayModel } from './todayModel'
import styles from './DashboardExperience.module.css'

/**
 * Today — the triage screen. It answers one question before any chrome: whose
 * report is waiting, and which one to open first.
 */
export default function DashboardExperience({
  model,
  practitionerInitials,
  todayLabel,
  loadError,
}: {
  model: TodayModel
  practitionerInitials: string
  todayLabel: string
  loadError: string | null
}) {
  return (
    <div className="app-screen">
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">{practitionerInitials}</span>
          <div>
            <p className={styles.wordmark}>
              <span className={styles.live} aria-hidden="true" />
              Posture AI
            </p>
            <p className={styles.today}>
              {todayLabel}
              {' · '}
              <span className={styles.todayQuiet}>{model.queueTotal} awaiting review</span>
            </p>
          </div>
        </div>
      </header>

      <section className={styles.verdict}>
        <p className="t-kicker" style={{ marginBottom: 12 }}>{model.kicker}</p>
        <h1 className="t-headline">
          {model.headline.lead}
          {model.headline.tail ? <> <em>{model.headline.tail}</em></> : null}
        </h1>
      </section>

      <div className="app-screen-x app-stack">
        {loadError ? (
          <Surface tier="tile">
            <p className={styles.notice} role="status">
              <Icon name="clock-circle-linear" size={16} />
              {loadError}
            </p>
          </Surface>
        ) : null}

        {/* Tier 1 — the screen's subject. */}
        <Surface tier="feature">
          <div className={styles.queueHead}>
            <h2 className="t-title">Awaiting your sign-off</h2>
            {model.queueTotal > 0
              ? <Chip band="monitor" size="sm"><span className="n">{model.queueTotal}</span> due</Chip>
              : <Chip band="maintain" size="sm" icon="check-circle-linear">Clear</Chip>}
          </div>

          {model.queue.length === 0 ? (
            <div className={styles.empty}>
              <p className="t-body">Every completed scan has been signed off.</p>
              <p className="t-quiet">New captures land here the moment scoring finishes.</p>
            </div>
          ) : (
            <div>
              {model.queue.map(item => (
                <Link key={item.id} href={item.href} className={styles.queueRow}>
                  <span className={styles.queueAvatar} aria-hidden="true">{item.initials}</span>
                  <span className={styles.queueBody}>
                    <span className={styles.queueName} style={{ display: 'block' }}>{item.name}</span>
                    <span className={styles.queueMeta} style={{ display: 'block' }}>{item.meta}</span>
                  </span>
                  {item.wait ? (
                    <span
                      className={`${styles.queueWait} n`}
                      style={{ color: item.oldest ? tone('monitor') : 'rgba(255,255,255,0.6)' }}
                    >
                      {item.wait}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}

          {model.primaryAction ? (
            <div className={styles.queueAction}>
              <Link href={model.primaryAction.href} className={`a-primary ${styles.fullBar}`}>
                {model.primaryAction.label}
              </Link>
            </div>
          ) : null}
        </Surface>

        {/* This product has no scheduling table, so the slot the design gives to
            "next booked session" carries the truthful equivalent: the client who
            has gone longest without a scan. Never presented as a booking. */}
        {model.rescan ? (
          <SurfaceLink href={model.rescan.href} tier="tile" pad="rowy" aria-label={model.rescan.name}>
            <span className={styles.infoRow}>
              <span className={styles.infoIcon} aria-hidden="true">
                <Icon name="calendar-linear" size={20} />
              </span>
              <span className={styles.infoBody}>
                <span className={styles.scanName} style={{ display: 'block' }}>{model.rescan.name}</span>
                <span className={styles.scanMeta} style={{ display: 'block' }}>{model.rescan.meta}</span>
              </span>
              <span className="t-quiet" style={{ flexShrink: 0 }}>{model.rescan.readout}</span>
            </span>
          </SurfaceLink>
        ) : null}

        <div className={styles.metrics}>
          {model.metrics.map(metric => (
            <Surface key={metric.key} tier="tile" innerClassName={styles.metric}>
              <div className={styles.metricTop}>
                <Icon name={metric.icon} size={17} />
                {metric.delta
                  ? <DeltaChip band={metric.deltaBand} icon={metric.deltaIcon}>{metric.delta}</DeltaChip>
                  : null}
              </div>
              <div>
                <p className={`${styles.metricValue} n`}>{metric.value}</p>
                <p className={styles.metricLabel}>{metric.label}</p>
              </div>
            </Surface>
          ))}
        </div>

        <div className={styles.sectionHead}>
          <h2 className="t-headline-sm">Recent scans</h2>
          <Link href="/clients" className={styles.seeAll}>
            See all
            <Icon name="arrow-right-up-linear" size={14} />
          </Link>
        </div>

        {model.recent.length === 0 ? (
          <Surface tier="row" pad="rowy">
            <p className="t-body">No completed scans yet. Capture one to start a history.</p>
          </Surface>
        ) : (
          model.recent.map(scan => (
            <SurfaceLink key={scan.id} href={scan.href} tier="row" aria-label={`${scan.name} — ${scan.meta}`}>
              <span className={styles.scanRow}>
                <GradeChip grade={scan.grade} />
                <span className={styles.scanBody}>
                  <span className={styles.scanName} style={{ display: 'block' }}>{scan.name}</span>
                  <span className={styles.scanMeta} style={{ display: 'block' }}>{scan.meta}</span>
                </span>
                <span style={{ flexShrink: 0, color: tone(scan.band) }}>
                  <Icon name={scan.icon} size={19} />
                </span>
              </span>
            </SurfaceLink>
          ))
        )}

      </div>
    </div>
  )
}
