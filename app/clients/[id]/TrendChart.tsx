'use client'
import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { Morph, ScoreScale, SlotNumber, TrendPlot, type TrendPoint } from '@/components/ui'
import { usesCurrentGradeScale } from '@/lib/scoring/grade-display'
import { buildTrendChart, type TrendInputPoint } from './trendModel'
import { formatClientDate } from './clientDate'
import styles from './ClientDetail.module.css'

const DEFERRED_SCORE_TABLE_MOUNT_MS = 300
const subscribeNever = () => () => {}

function utcDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10)
}

function RecordedScoreDisclosure({
  history,
  tableId,
  footnote,
}: {
  history: readonly TrendInputPoint[]
  tableId: string
  footnote: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isTableMounted, setIsTableMounted] = useState(false)
  const [isPointerGuardReady, setIsPointerGuardReady] = useState(false)
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const disclosureLabel = isPointerGuardReady ? 'Score details' : 'Preparing score details…'

  useEffect(() => {
    const disclosure = disclosureRef.current
    if (!disclosure) return
    // Chromium can spend most of this interaction repainting the glass-backed
    // chart while assigning mouse focus. Attach at the target so the native
    // focus path is cancelled before React's delegated event phase. Touch and
    // keyboard focus keep their normal semantics.
    const skipMouseFocus = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button === 0 && event.isPrimary) {
        event.preventDefault()
      }
    }
    disclosure.addEventListener('pointerdown', skipMouseFocus)
    // The server-rendered control stays inert until hydration has installed the
    // native pointer guard. Otherwise its first pointerdown pays React's
    // selective-hydration cost as part of the interaction itself.
    setIsPointerGuardReady(true)
    return () => disclosure.removeEventListener('pointerdown', skipMouseFocus)
  }, [])

  useEffect(() => {
    if (!isOpen || isTableMounted) return
    // Let the disclosure paint first, then retain the table so later closes and
    // reopens do no additional mount work.
    const timer = window.setTimeout(() => {
      startTransition(() => setIsTableMounted(true))
    }, DEFERRED_SCORE_TABLE_MOUNT_MS)
    return () => window.clearTimeout(timer)
  }, [isOpen, isTableMounted])

  return (
    <div className={styles.dataDetails} data-open={isOpen}>
      <button
        ref={disclosureRef}
        type="button"
        className={styles.dataSummary}
        aria-label={disclosureLabel}
        aria-expanded={isOpen}
        aria-busy={!isPointerGuardReady}
        aria-controls={`${tableId}-panel`}
        disabled={!isPointerGuardReady}
        onClick={() => setIsOpen(open => !open)}
      >
        {disclosureLabel}
      </button>
      <div id={`${tableId}-panel`} hidden={!isOpen}>
        {isTableMounted ? (
          <>
            <p className={styles.trendFootnote}>{footnote}</p>
            <table className={styles.dataTable} id={tableId}>
              <caption className="sr-only">
                Every recorded screening score for this client, with its grade and scoring version.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Score</th>
                  <th scope="col">Scoring version</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(point => (
                  <tr key={point.id}>
                    <td>{formatClientDate(point.assessedAt, 'day-month-short')}</td>
                    <td>{point.grade ?? '—'}</td>
                    <td className="n">{point.score === null ? '—' : `${Math.round(point.score)} / 100`}</td>
                    <td>{point.scoringEngineVersion ?? 'Unknown — not comparable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : isOpen ? (
          <p className={styles.loadingPanel} role="status">Preparing score details…</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Deviation score over time (docs/design/array-v4-dataviz.md § C + § D) — the
 * client page's one hero. The latest score is the hero numeral on the 0–100
 * scale with the band cutoffs printed; the previous comparable score is text.
 * Under it the trend plot: real dates, fixed 0–100, band fields labelled, a
 * gap where scoring versions change, scrub or step to any scan. The selected
 * scan opens from the line under the plot.
 *
 * The plot formats dates in the viewer's locale, so it mounts after hydration;
 * the sentence in `model.description` and the Score details table are the
 * accessible and server-rendered representation.
 */
export default function TrendChart({
  history,
  tableId,
}: {
  history: readonly TrendInputPoint[]
  tableId: string
}) {
  const model = buildTrendChart(history)
  const verdict = model.verdict
  // False on the server and during hydration, true after: the plot's locale dates never mismatch.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false)
  const scored = history.filter((point) => point.score !== null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (model.points.length === 0) {
    return (
      <section className={styles.scoreHero} aria-labelledby={`${tableId}-title`}>
        <h2 id={`${tableId}-title`} className="t-micro">Deviation score</h2>
        <p className={styles.heroEmpty}>No score yet</p>
        <p className="t-label">The first completed scan starts this trend.</p>
      </section>
    )
  }

  const latest = scored[scored.length - 1]
  const prior = scored.length > 1 ? scored[scored.length - 2] : null
  const comparablePrior = prior
    && verdict
    && verdict.decision.status !== 'not_comparable'
    && prior.segmentId === latest.segmentId
    ? { score: prior.score as number, date: formatClientDate(prior.assessedAt, 'day-month-short-no-year') }
    : undefined
  const scaleApplies = usesCurrentGradeScale(latest.scoringEngineVersion)
  const latestScore = latest.score as number
  const selected = history.find((point) => point.id === selectedId) ?? latest

  const points: TrendPoint[] = history.map((point, index) => ({
    id: point.id,
    // Date-only (UTC calendar day): the plot reads it as local noon, so its
    // labels agree with every other date on this page.
    date: utcDay(point.assessedAt),
    score: point.score,
    comparable: index === 0 || history[index - 1].segmentId === point.segmentId,
  }))

  return (
    <section className={styles.scoreHero} aria-labelledby={`${tableId}-title`}>
      <h2 id={`${tableId}-title`} className="sr-only">Deviation score</h2>
      <p className="sr-only">{model.description}</p>
      <div aria-label={`Latest deviation score ${Math.round(latestScore)} out of 100`} role="group">
        {scaleApplies ? (
          <div aria-hidden="true">
            <ScoreScale
              score={latestScore}
              label={`Deviation score · ${formatClientDate(latest.assessedAt, 'day-month-short-no-year')}`}
              previous={comparablePrior}
            />
          </div>
        ) : (
          <div aria-hidden="true" className={styles.recordedScore}>
            <span className="t-micro">Deviation score · as recorded</span>
            <span className={styles.recordedValue}>
              <SlotNumber value={Math.round(latestScore)} />
              <span className={styles.recordedOf}>/100</span>
            </span>
          </div>
        )}
      </div>

      {verdict ? <p className={styles.verdictLine}>{verdict.text}</p> : null}

      {mounted && scored.length > 1 ? (
        <div className={styles.plot}>
          <TrendPlot
            points={points}
            initialIndex={history.findIndex((point) => point.id === selected.id)}
            onSelect={(point) => setSelectedId(point.id)}
          />
        </div>
      ) : null}

      <div className={styles.heroLinks}>
        <Morph name={`scan-${selected.id}`}>
          <Link href={`/assessments/${selected.id}`} className={styles.heroLink} prefetch={false}>
            Open scan · <span className="n">{formatClientDate(selected.assessedAt, 'day-month-short-no-year')}</span>
            <Icon name="alt-arrow-right-linear" size={16} />
          </Link>
        </Morph>
        <RecordedScoreDisclosure history={history} tableId={tableId} footnote={model.footnote} />
      </div>
    </section>
  )
}
