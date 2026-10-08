'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Morph,
  SeverityChip,
  SlotNumber,
  TopBar,
} from '@/components/ui'
import type { HeroState, MetricTile, QueueItem, SetupChecklist, TodayModel } from './todayModel'
import styles from './DashboardExperience.module.css'

const STAGGER_CAP = 8

function stagger(index: number): CSSProperties {
  return { '--i': Math.min(index, STAGGER_CAP) } as CSSProperties
}

/**
 * Today — the triage screen. It answers one question before anything else:
 * how many reports are waiting, and which to open first (dataviz F). The hero
 * holds the count, the three oldest reports and the one primary action;
 * everything below is quiet supporting rows on the canvas.
 */
export default function DashboardExperience({
  model,
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
      <TopBar title="Today" subtitle={todayLabel} />

      <div className={`app-screen-x ${styles.page}`}>
        {loadError ? (
          // A failed query and an empty practice are indistinguishable once the
          // counts fall back to zero, so a Supabase blip would otherwise render
          // as "no clients, queue clear" — the most dangerous possible reading
          // of a triage screen. Bail out before any of that is drawn.
          //
          // `reload()` rather than a client-side retry: this page's data comes
          // from a server component, so recovery needs a fresh document request.
          <ErrorState
            variant="page"
            title="Practice data could not load."
            body={loadError}
            onRetry={() => window.location.reload()}
          />
        ) : model.isFirstRun ? (
          <>
            <EmptyState
              icon="users-group-rounded-linear"
              title="Get set up"
              body="Add your first client, then run a scan and build a workout for them."
              primary={{ label: 'Add your first client', href: '/clients/new' }}
            />
            <SetupSteps setup={model.setup} />
          </>
        ) : (
          <>
            {model.hero ? (
              <TodayHero
                hero={model.hero}
                queue={model.queue}
                queueTotal={model.queueTotal}
              />
            ) : null}

            {model.queueTotal > 0 && model.rescan ? (
              <section className={styles.section} aria-labelledby="today-rescan">
                <div className={styles.sectionHead}>
                  <h2 id="today-rescan" className="t-headline">Re-scan due</h2>
                </div>
                <ul className={styles.rows}>
                  <li className={styles.rowItem} style={stagger(0)}>
                    <Link href={model.rescan.href} className={styles.row}>
                      {/* Shares the client header's morph name: the identity carries into the record. */}
                      <Morph name={`client-${model.rescan.id}`}>
                        <span className={styles.identity}>
                          <span aria-hidden="true"><Avatar name={model.rescan.name} /></span>
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>{model.rescan.name}</span>
                            <span className="t-label">
                              {[
                                model.rescan.lastScan ? `Latest scan · ${model.rescan.lastScan}` : null,
                                model.rescan.since?.toLowerCase() ?? null,
                              ].filter(Boolean).join(' · ') || 'Re-scan due'}
                            </span>
                          </span>
                        </span>
                      </Morph>
                      <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
                    </Link>
                  </li>
                </ul>
              </section>
            ) : null}

            <section className={styles.section} aria-labelledby="today-recent">
              <div className={styles.sectionHead}>
                <h2 id="today-recent" className="t-headline">Recent scans</h2>
                {model.recent.length > 0 ? (
                  <Link href="/clients" className={styles.quietLink}>
                    See all<span className="sr-only"> clients</span>
                    <Icon name="alt-arrow-right-linear" size={16} />
                  </Link>
                ) : null}
              </div>
              {model.recent.length === 0 ? (
                <p className={`t-callout ${styles.emptyLine}`}>No completed scans yet. Capture one to start a history.</p>
              ) : (
                <ul className={styles.rows} aria-label="Recent scans">
                  {model.recent.map((scan, index) => (
                    <li key={scan.id} className={styles.rowItem} style={stagger(index)}>
                      <Link href={scan.href} className={styles.row}>
                        <span aria-hidden="true"><Avatar name={scan.name} /></span>
                        <span className={styles.rowText}>
                          <span className={styles.rowName}>{scan.name}</span>
                          <span className="t-label">{scan.meta}</span>
                        </span>
                        <SeverityChip band={scan.band} size="sm" />
                        <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <WeekStrip metrics={model.metrics} />

            {model.setup.doneCount < model.setup.total ? (
              <SetupLine setup={model.setup} />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The screen's one hero (liquid glass): the waiting count as a hero numeral
 * that slots into place, the three oldest reports with their exact wait, and
 * the primary action that opens the oldest. With an empty queue it states
 * that plainly and offers the next scan instead.
 */
function TodayHero({ hero, queue, queueTotal }: { hero: HeroState; queue: QueueItem[]; queueTotal: number }) {
  if (queueTotal === 0 || queue.length === 0) {
    return (
      <Surface tier="feature" className={styles.hero} data-testid="today-hero">
        <p className="t-micro">Review queue</p>
        <h2 className={`t-title ${styles.clearTitle}`}>Queue clear</h2>
        <p className={`t-body ${styles.heroSentence}`}>{hero.sentence}</p>
        <Button href={hero.action.href} size="lg" block icon="scanner-linear">
          {hero.action.label}
        </Button>
      </Surface>
    )
  }

  return (
    <Surface tier="feature" sheen className={styles.hero} data-testid="today-hero">
      <p className="t-micro">Review queue</p>
      <h2 className={styles.count}>
        <SlotNumber value={queueTotal} className={`t-hero ${styles.countValue}`} />
        <span className={`t-headline ${styles.countLabel}`}>
          {queueTotal === 1 ? 'report waiting' : 'reports waiting'}
        </span>
      </h2>
      {/* The sentence carries the same fact for assistive tech in one breath. */}
      <p className="sr-only">{hero.sentence}</p>

      <ul className={styles.queue} aria-label="Oldest waiting reports">
        {queue.map((item, index) => (
          <li key={item.id} className={styles.rowItem} style={stagger(index + 1)}>
            <Link
              href={item.href}
              className={styles.queueRow}
              aria-label={[
                item.name,
                item.waitSpoken ? `waiting ${item.waitSpoken}` : null,
                item.received ? `received ${item.received}` : null,
              ].filter(Boolean).join(', ')}
            >
              <span className={styles.rowText}>
                <span className={styles.rowName}>{item.name}</span>
                <span className="t-label">
                  {[item.received ? `Received ${item.received}` : null, `${item.findingCount} ${item.findingCount === 1 ? 'finding' : 'findings'}`]
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              {item.wait ? <span className={styles.wait}>{item.wait}</span> : null}
              <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
            </Link>
          </li>
        ))}
      </ul>

      {queueTotal > queue.length ? (
        <Link href="/clients?filter=needs-review" className={styles.viewAll}>
          View all {queueTotal}
          <Icon name="alt-arrow-right-linear" size={16} />
        </Link>
      ) : null}

      <Button href={hero.action.href} size="lg" block className={styles.heroAction}>
        {hero.action.label}
      </Button>
    </Surface>
  )
}

/** This week as three plain readouts on the canvas — no card, neutral deltas. */
function WeekStrip({ metrics }: { metrics: MetricTile[] }) {
  return (
    <section className={styles.section} aria-labelledby="today-week">
      <div className={styles.sectionHead}>
        <h2 id="today-week" className="t-headline">This week</h2>
      </div>
      <dl className={styles.week}>
        {metrics.map(metric => (
          <div key={metric.key} className={styles.weekCell}>
            <dt className="t-micro">{metric.label}</dt>
            <dd className={styles.weekValue}>
              <span className="t-title">{metric.value}</span>
              {metric.delta ? (
                <span className={`t-label ${styles.weekDelta}`}>
                  <span aria-hidden="true">{metric.delta.value > 0 ? '↑' : '↓'}</span>
                  <span className="sr-only">{metric.delta.value > 0 ? 'up' : 'down'}</span>
                  {Math.abs(metric.delta.value)}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Unfinished setup, demoted to one quiet line at the foot of the screen. */
function SetupLine({ setup }: { setup: SetupChecklist }) {
  const next = setup.steps.find(step => !step.done)
  return (
    <Link href={next?.href ?? '/clients/new'} className={styles.setupLine} data-testid="setup-checklist">
      <span className={styles.setupDots} aria-hidden="true">
        {setup.steps.map(step => (
          <span key={step.id} className={styles.setupDot} data-done={step.done ? 'true' : undefined} />
        ))}
      </span>
      <span className={styles.rowText}>
        <span className="t-callout">Setup · {setup.doneCount} of {setup.total}</span>
        {next ? <span className="t-label">Next: {next.label}</span> : null}
      </span>
      <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
    </Link>
  )
}

/** First-run steps as hairline rows under the empty state (no second card). */
function SetupSteps({ setup }: { setup: SetupChecklist }) {
  return (
    <section className={styles.section} aria-labelledby="today-setup" data-testid="setup-checklist">
      <div className={styles.sectionHead}>
        <h2 id="today-setup" className="t-headline">Get set up · {setup.total} steps</h2>
        <span className="t-label">{setup.doneCount} of {setup.total} done</span>
      </div>
      <ol className={styles.rows}>
        {setup.steps.map((step, index) => {
          const body = (
            <>
              <span className={styles.stepMark} data-done={step.done ? 'true' : undefined} aria-hidden="true">
                {step.done ? <Icon name="check-circle-bold" size={22} /> : index + 1}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{step.label}</span>
              </span>
              {step.done ? null : <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />}
            </>
          )
          return (
            <li key={step.id} className={styles.rowItem} style={stagger(index)}>
              {step.done ? (
                <div className={styles.row} aria-label={`${step.label}, done`}>{body}</div>
              ) : (
                <Link href={step.href} className={styles.row}>{body}</Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
