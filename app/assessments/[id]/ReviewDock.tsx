'use client'

import styles from './AssessmentReviewStudio.module.css'

export type ReviewSaveState = 'idle' | 'saving' | 'failed'
export type ReportKind = 'practitioner' | 'client'

type ComparisonOption = {
  id: string
  label: string
}

export type ReviewDockProps = {
  clientName: string
  assessedAtLabel: string
  grade: string
  score: number
  gradeDescription: string
  reliabilityLabel: string
  reliabilityDetail: string | null
  unreliableCount: number
  isApproved: boolean
  saveState: ReviewSaveState
  hasSession: boolean
  isApproving: boolean
  isLaunching: boolean
  onApprove: () => void
  onLaunch: () => void
  onRetrySave: () => void
  pdfLoading: ReportKind | null
  pdfUrl: string | null
  pdfKind: ReportKind
  onGeneratePdf: (kind: ReportKind) => void
  comparisonId: string
  comparisonOptions: ComparisonOption[]
  onComparisonChange: (id: string) => void
  hasMoreComparisonOptions: boolean
  isLoadingMoreComparisonOptions: boolean
  onLoadMoreComparisonOptions: () => void
  isSharing: boolean
  shareLink: string | null
  copied: boolean
  onShare: () => void
  onCopyShare: () => void
  backHref: string
  newAssessmentHref: string
}

export default function ReviewDock({
  clientName,
  assessedAtLabel,
  grade,
  score,
  gradeDescription,
  reliabilityLabel,
  reliabilityDetail,
  unreliableCount,
  isApproved,
  saveState,
  hasSession,
  isApproving,
  isLaunching,
  onApprove,
  onLaunch,
  onRetrySave,
  pdfLoading,
  pdfUrl,
  pdfKind,
  onGeneratePdf,
  comparisonId,
  comparisonOptions,
  onComparisonChange,
  hasMoreComparisonOptions,
  isLoadingMoreComparisonOptions,
  onLoadMoreComparisonOptions,
  isSharing,
  shareLink,
  copied,
  onShare,
  onCopyShare,
  backHref,
  newAssessmentHref,
}: ReviewDockProps) {
  const areDependentActionsDisabled = saveState !== 'idle'
  const areExportsDisabled = !isApproved || areDependentActionsDisabled || pdfLoading !== null

  let primaryAction = null
  if (saveState === 'saving') {
    primaryAction = <button type="button" className={styles.primaryAction} data-visual-weight="primary" disabled><span>Saving changes…</span></button>
  } else if (saveState === 'failed') {
    primaryAction = <button type="button" className={styles.primaryAction} data-visual-weight="primary" onClick={onRetrySave}><span>Retry save</span></button>
  } else if (!isApproved) {
    primaryAction = (
      <button
        type="button"
        className={styles.primaryAction}
        data-testid="approve-report"
        data-visual-weight="primary"
        disabled={isApproving}
        onClick={onApprove}
      >
        <span>{isApproving ? 'Approving…' : 'Approve report'}</span>
      </button>
    )
  } else if (hasSession) {
    primaryAction = (
      <button
        type="button"
        className={styles.primaryAction}
        data-testid="launch-session"
        data-visual-weight="primary"
        disabled={isLaunching}
        onClick={onLaunch}
      >
        <span>{isLaunching ? 'Starting…' : 'Launch session'}</span>
      </button>
    )
  } else {
    primaryAction = (
      <button
        type="button"
        className={styles.primaryAction}
        data-visual-weight="primary"
        disabled={pdfLoading !== null}
        onClick={() => onGeneratePdf('client')}
      >
        <span>{pdfLoading === 'client' ? 'Generating…' : 'Client report'}</span>
      </button>
    )
  }

  return (
    <aside className={styles.dock} data-testid="review-dock" aria-label="Assessment review controls">
      <div className={styles.dockSummary}>
        <div className={styles.identity}>
          <div>
            <span className={styles.quietLabel}>Assessment review</span>
            <h2>{clientName}</h2>
            <p>{assessedAtLabel}</p>
          </div>
          <div className={styles.gradeReadout} aria-label={`Grade ${grade}, deviation ${score} out of 100`}>
            <span>Grade</span>
            <strong className="data-readout">{grade}</strong>
            <small className="data-readout">{score}/100</small>
            <em>{gradeDescription}</em>
          </div>
        </div>

        <dl className={styles.stateList}>
          <div>
            <dt>Reliability</dt>
            <dd>{reliabilityLabel}</dd>
            {reliabilityDetail && <dd className={styles.stateDetail}>{reliabilityDetail}</dd>}
            {unreliableCount > 0 && <dd className={styles.stateDetail}>{unreliableCount} {unreliableCount === 1 ? 'reading' : 'readings'} unavailable</dd>}
          </div>
          <div>
            <dt>Approval</dt>
            <dd>{isApproved ? 'Practitioner approved' : 'Review required'}</dd>
          </div>
          <div>
            <dt>Program save</dt>
            <dd>{saveState === 'idle' ? 'All changes saved' : saveState === 'saving' ? 'Saving changes' : 'Save failed'}</dd>
          </div>
        </dl>
      </div>

      <div className={styles.dockActions}>
        {saveState === 'failed' && (
          <p className={styles.actionAlert} role="alert">Program changes were not saved. Retry before using the report or session.</p>
        )}
        {primaryAction}
        {isApproved && !hasSession && (
          <p className={styles.actionHint} role="status">Approved. No guided session is available for the reliable findings in this screen; export the client report instead.</p>
        )}
        {!isApproved && saveState === 'idle' && (
          <p className={styles.actionHint}>Approval unlocks report export and the guided session.</p>
        )}

        <div className={styles.secondaryActions} aria-label="Report actions">
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={areExportsDisabled}
            onClick={() => onGeneratePdf('practitioner')}
          >
            {pdfLoading === 'practitioner' ? 'Generating…' : 'Practitioner PDF'}
          </button>
          {(!isApproved || hasSession) && (
            <button
              type="button"
              className={styles.secondaryAction}
              disabled={areExportsDisabled}
              onClick={() => onGeneratePdf('client')}
            >
              {pdfLoading === 'client' ? 'Generating…' : 'Client report'}
            </button>
          )}
          {hasSession && !shareLink && (
            <button
              type="button"
              className={styles.secondaryAction}
              data-testid="share-session"
              disabled={!isApproved || areDependentActionsDisabled || isSharing}
              onClick={onShare}
            >
              {isSharing ? 'Creating link…' : 'Share session'}
            </button>
          )}
        </div>

        {(comparisonOptions.length > 0 || hasMoreComparisonOptions) && (
          <div className={styles.comparisonField}>
            {comparisonOptions.length > 0 && (
              <label htmlFor="compare-prior">
                <span>Compare report</span>
                <select id="compare-prior" value={comparisonId} onChange={(event) => onComparisonChange(event.target.value)}>
                  <option value="">No prior comparison</option>
                  {comparisonOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
            )}
            {hasMoreComparisonOptions && (
              <button
                type="button"
                className={styles.secondaryAction}
                disabled={isLoadingMoreComparisonOptions}
                onClick={onLoadMoreComparisonOptions}
              >
                {isLoadingMoreComparisonOptions ? 'Loading older reports…' : 'Load older report options'}
              </button>
            )}
          </div>
        )}

        {shareLink && (
          <div className={styles.shareField}>
            <label htmlFor="client-share-link">Client session link</label>
            <input id="client-share-link" readOnly value={shareLink} data-testid="share-link" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={styles.secondaryAction} onClick={onCopyShare}>{copied ? 'Copied' : 'Copy link'}</button>
            <span className={styles.srOnly} aria-live="polite">{copied ? 'Client link copied to clipboard' : ''}</span>
          </div>
        )}

        {pdfUrl && (
          <a className={styles.downloadAction} href={pdfUrl} target="_blank" rel="noopener noreferrer">
            Download {pdfKind === 'client' ? 'client report' : 'practitioner PDF'}
          </a>
        )}

        <div className={styles.routeLinks}>
          <a href={backHref}>Back to client</a>
          <a href={newAssessmentHref}>New assessment</a>
        </div>
      </div>

    </aside>
  )
}
