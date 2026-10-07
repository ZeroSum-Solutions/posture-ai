'use client'

import Icon from '@/components/array/Icon'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  ProgressRing,
  SectionHeader,
  SeverityChip,
  Stat,
  TopBar,
} from '@/components/ui'
import type { SetupChecklist, TodayModel } from './todayModel'
import styles from './DashboardExperience.module.css'

/**
 * Today — the triage screen. It answers one question before any chrome: whose
 * report is waiting, and which one to open first (DESIGN.md › Today).
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

      <div className="app-screen-x app-stack">
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
            <SetupChecklistCard setup={model.setup} />
          </>
        ) : (
          <>
            {model.setup.doneCount < model.setup.total ? (
              <SetupChecklistRow setup={model.setup} />
            ) : null}

            {model.hero ? (
              <Card tier="feature" data-testid="today-hero">
                <p className="t-body" style={{ color: 'var(--text-1)' }}>{model.hero.sentence}</p>
                <Button href={model.hero.action.href} size="lg" block style={{ marginTop: 'var(--s-16)' }}>
                  {model.hero.action.label}
                </Button>
              </Card>
            ) : null}

            {model.needsAttention.length > 0 ? (
              <section>
                <SectionHeader
                  title="Needs attention"
                  action={{ label: 'See all', href: '/clients?filter=needs-review' }}
                />
                <ListGroup label="Needs attention">
                  {model.needsAttention.map(item => (
                    <ListRow
                      key={item.id}
                      href={item.href}
                      title={item.name}
                      subtitle={item.subtitle}
                      chevron
                    />
                  ))}
                </ListGroup>
              </section>
            ) : null}

            <section>
              <SectionHeader title="Recent scans" action={{ label: 'See all', href: '/clients' }} />
              {model.recent.length === 0 ? (
                <ListGroup label="Recent scans">
                  <ListRow title="No completed scans yet" subtitle="Capture one to start a history." />
                </ListGroup>
              ) : (
                <ListGroup label="Recent scans">
                  {model.recent.map(scan => (
                    <ListRow
                      key={scan.id}
                      href={scan.href}
                      title={scan.name}
                      subtitle={scan.meta}
                      trailing={<SeverityChip band={scan.band} size="sm" />}
                      chevron
                    />
                  ))}
                </ListGroup>
              )}
            </section>

            <div className={styles.statsStrip} aria-label="This week">
              {model.metrics.map(metric => (
                <Stat key={metric.key} label={metric.label} value={metric.value} delta={metric.delta ?? undefined} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Done = a filled check circle in `--maintain`; not done = a plain numbered outline. */
function StepIndicator({ done, position }: { done: boolean; position: number }) {
  if (done) {
    return (
      <span className={styles.stepDone} aria-hidden="true">
        <Icon name="check-circle-bold" size={22} />
      </span>
    )
  }
  return <span className={styles.stepPending} aria-hidden="true">{position}</span>
}

/** Expanded setup card — first-run only, the screen's one card-glass hero. */
function SetupChecklistCard({ setup }: { setup: SetupChecklist }) {
  return (
    <Card tier="feature" data-testid="setup-checklist">
      <div className={styles.setupHead}>
        <h2 className="t-headline">Get set up · 3 steps</h2>
        <ProgressRing value={setup.doneCount / setup.total} size={48} label="Setup checklist" />
      </div>
      <ListGroup label="Setup steps">
        {setup.steps.map((step, index) => (
          <ListRow
            key={step.id}
            leading={<StepIndicator done={step.done} position={index + 1} />}
            title={step.label}
            href={step.done ? undefined : step.href}
            chevron={!step.done}
            aria-label={step.done ? `${step.label}, done` : step.label}
          />
        ))}
      </ListGroup>
    </Card>
  )
}

/** Collapsed one-line row — shown above the hero once the practice is past
 * first-run but the checklist isn't finished yet. Flat (never a second
 * card-glass surface alongside the hero). */
function SetupChecklistRow({ setup }: { setup: SetupChecklist }) {
  const next = setup.steps.find(step => !step.done)
  return (
    <ListGroup label="Setup checklist">
      <ListRow
        leading={<ProgressRing value={setup.doneCount / setup.total} size={48} label="Setup checklist" />}
        title={`Setup — ${setup.doneCount} of ${setup.total}`}
        subtitle={next ? `Next: ${next.label}` : undefined}
        href={next?.href ?? '/clients/new'}
        chevron
      />
    </ListGroup>
  )
}
