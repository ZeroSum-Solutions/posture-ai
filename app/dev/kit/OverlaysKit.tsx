'use client'

/**
 * Overlays-lane demos for the component kit (/dev/kit): Banner, the loaders
 * (Lens loader, Spinner, Skeleton, ProgressBar/Ring, PullToRefresh), Empty
 * and Error states, Sheet / Dialog / Toast (the Island), and ActionBar inside
 * a contained frame so its fixed positioning does not cover the page. Kept
 * out of page.tsx so lanes can edit the kit side by side.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  ActionBar,
  Banner,
  BlobLoader,
  Button,
  CardSkeleton,
  Dialog,
  DotsBounce,
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  ProgressBar,
  ProgressRing,
  PullToRefresh,
  Sheet,
  Skeleton,
  Spinner,
  useToast,
} from '@/components/ui'

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-8)' }}>
      <p className="t-micro">{label}</p>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-8)', alignItems: 'center' }}>{children}</div>
}

/* ── Banner ─────────────────────────────────────────────────────────── */

export function BannerKit() {
  const [hint, setHint] = useState(true)
  return (
    <>
      <Banner variant="info" why={{ onPress: () => {} }}>Compare two scans side by side.</Banner>
      <Banner variant="warn" action={{ label: 'Send consent', onPress: () => {} }}>Consent expires in 3 days.</Banner>
      <Banner variant="error">Could not reach the server. Changes are saved on this device.</Banner>
      <Banner variant="success">Program assigned to Jordan Pierce.</Banner>
      {hint ? (
        <Banner variant="info" hint onDismiss={() => setHint(false)}>Stand 2 m back, full body in frame.</Banner>
      ) : (
        <Button size="sm" variant="tertiary" onClick={() => setHint(true)}>Show hint again</Button>
      )}
    </>
  )
}

/* ── Loaders ────────────────────────────────────────────────────────── */

/** Steps a value up so the springs are visible; resets after it completes. */
function useTicker(step: number, ms: number) {
  const [value, setValue] = useState(0.18)
  useEffect(() => {
    const t = setInterval(() => setValue((v) => (v >= 1 ? 0.18 : Math.min(1, v + step))), ms)
    return () => clearInterval(t)
  }, [step, ms])
  return value
}

function LiveProgress() {
  const value = useTicker(0.17, 1400)
  // Remount on reset — the bar never moves backward by contract.
  const [epoch, setEpoch] = useState(0)
  const [last, setLast] = useState(value)
  if (value < last) {
    setEpoch((e) => e + 1)
  }
  if (value !== last) setLast(value)
  return (
    <>
      <ProgressBar key={`bar-${epoch}`} value={value} label="Processing views" />
      <Row>
        <ProgressRing key={`ring-${epoch}`} value={value} label="Setup checklist" />
        <ProgressRing value={0.42} size={72} label="Program done" />
        <ProgressRing value={1} label="Complete" />
      </Row>
    </>
  )
}

function PullDemo() {
  const [refreshedAt, setRefreshedAt] = useState<string>('never')
  return (
    <PullToRefresh
      label="Demo list"
      forceDragGesture
      onRefresh={() =>
        new Promise((resolve) =>
          setTimeout(() => {
            setRefreshedAt(new Date().toLocaleTimeString())
            resolve()
          }, 1600),
        )
      }
    >
      <div style={{ padding: 'var(--s-16) 0', borderTop: '1px solid var(--hairline)', borderBottom: '1px solid var(--hairline)' }}>
        <p className="t-callout" style={{ color: 'var(--ink-1)' }}>Pull this row down with the mouse or a finger</p>
        <p className="t-label">Last refreshed: {refreshedAt}</p>
      </div>
    </PullToRefresh>
  )
}

export function LoadersKit() {
  const progress = useTicker(0.12, 1200)
  return (
    <>
      <Demo label="Lens loader (BlobLoader) — long jobs, rolling steps, real progress">
        <div style={{ padding: 'var(--s-16) 0' }}>
          <BlobLoader label="Analyzing posture" steps={['Reading front view', 'Reading side view', 'Reading back view']} progress={progress} />
        </div>
      </Demo>
      <Demo label="Spinner — inline only (16 / 24 / 40 · volt, on volt, muted)">
        <Row>
          <Spinner size={16} />
          <Spinner size={24} />
          <Spinner size={40} />
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 44, height: 44, borderRadius: 'var(--r-full)', background: 'var(--volt)' }}>
            <Spinner size={24} tone="onAction" />
          </span>
          <Spinner size={24} tone="muted" />
        </Row>
      </Demo>
      <Demo label="DotsBounce">
        <DotsBounce label="Saving" />
      </Demo>
      <Demo label="Skeleton — text, hairline rows (the shimmer rolls down as a wave), card">
        <Skeleton shape="line" lines={3} />
        <div>
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
        <CardSkeleton />
      </Demo>
      <Demo label="ProgressBar / ProgressRing — live, a value that only moves forward">
        <LiveProgress />
      </Demo>
      <Demo label="PullToRefresh — the Lens rises, arms at 72px, loads">
        <PullDemo />
      </Demo>
    </>
  )
}

/* ── Empty & Error states ───────────────────────────────────────────── */

function RetryingError() {
  const [retrying, setRetrying] = useState(false)
  return (
    <ErrorState
      variant="inline"
      title="Could not load this exercise"
      body="Check your connection and try again."
      retrying={retrying}
      onRetry={() => {
        setRetrying(true)
        setTimeout(() => setRetrying(false), 1800)
      }}
      secondary={{ label: 'Contact support', onPress: () => {} }}
      details="GET /api/clinical-content/exercises/lateral-raise → 503"
    />
  )
}

export function StatesKit() {
  return (
    <>
      <Demo label="EmptyState — page (ghost Lens, on the canvas)">
        <EmptyState
          icon="users-group-rounded-linear"
          title="No clients yet"
          body="Add one to run your first scan."
          primary={{ label: 'Add client', onPress: () => {} }}
          secondary={{ label: 'Import a list', onPress: () => {} }}
        />
      </Demo>
      <Demo label="EmptyState — inline">
        <EmptyState variant="inline" icon="image-off-linear" title="No photo for this view" body="This view was not captured." secondary={{ label: 'Retake', onPress: () => {} }} />
      </Demo>
      <Demo label="ErrorState — inline: Retry (press it), quiet action, Details">
        <RetryingError />
      </Demo>
    </>
  )
}

/* ── Sheet / Dialog / Toast ─────────────────────────────────────────── */

function SheetDemo() {
  const [open, setOpen] = useState<null | 'compact' | 'medium' | 'stack'>(null)
  return (
    <>
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setOpen('compact')}>Compact</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('medium')}>Medium ⇄ large</Button>
      </Row>
      <Sheet
        open={open != null}
        onOpenChange={(o) => setOpen(o ? open : null)}
        title="Lateral raise"
        detents={open === 'compact' ? ['compact'] : ['medium', 'large']}
        footer={<Button block size="lg">Add to program</Button>}
      >
        <p className="t-body">3 sets · 12 reps. Raises the arm to shoulder height, working the lateral deltoid.</p>
        <p className="t-body" style={{ marginTop: 'var(--s-12)' }}>
          The sheet grew out of the button you pressed. Drag the header up to glide to the large detent, down to come back; past 150 px or a fast flick dismisses.
        </p>
      </Sheet>
    </>
  )
}

function DialogDemo() {
  const [open, setOpen] = useState<null | 'primary' | 'danger'>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setOpen('primary')}>Confirm</Button>
        <Button size="sm" variant="secondary" onClick={() => { setError(null); setOpen('danger') }}>Delete…</Button>
      </Row>
      <Dialog
        open={open === 'primary'}
        onOpenChange={(o) => setOpen(o ? 'primary' : null)}
        title="Save changes?"
        description="Your edits to this program will be saved."
        confirm={{ label: 'Save', onConfirm: () => setOpen(null) }}
      />
      <Dialog
        open={open === 'danger'}
        onOpenChange={(o) => setOpen(o ? 'danger' : null)}
        title="Delete this client?"
        description="This removes their scans, notes and programs. This can't be undone."
        error={error}
        confirm={{
          label: 'Delete',
          tone: 'danger',
          busy,
          onConfirm: () => {
            setBusy(true)
            setTimeout(() => { setBusy(false); setError('Could not delete. Try again.') }, 1200)
          },
        }}
      />
    </>
  )
}

function ToastButtons() {
  const toast = useToast()
  return (
    <Row>
      <Button size="sm" variant="secondary" onClick={() => toast.success('Scan saved')}>Success</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.info('New assessment ready')}>Info</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.warn('Consent expires soon')}>Warn</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.error('Could not save the program', { sticky: true })}>Error (sticky)</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.info('Program updated', { action: { label: 'Undo', onPress: () => {} } })}>With action</Button>
    </Row>
  )
}

export function OverlaysKit() {
  return (
    <>
      <Demo label="Sheet — grows from its cause; detents glide">
        <SheetDemo />
      </Demo>
      <Demo label="Dialog — leans in from its cause; danger is an alertdialog (try the failing delete)">
        <DialogDemo />
      </Demo>
      <Demo label="Toast — the Island grows from a capsule and morphs between messages">
        <ToastButtons />
      </Demo>
    </>
  )
}

/* ── ActionBar ──────────────────────────────────────────────────────── */

/**
 * The ActionBar is `position: fixed`; a transformed frame becomes its
 * containing block, so the demo stays inside its own box instead of covering
 * the page. The dock is not in the frame, so its clearance is zeroed.
 */
export function ActionBarKit() {
  return (
    <Demo label="ActionBar — the thumb-zone row on a canvas fade (contained demo)">
      <div
        style={{
          position: 'relative',
          height: 260,
          overflow: 'hidden',
          borderRadius: 'var(--r-md)',
          boxShadow: 'inset 0 0 0 1px var(--hairline)',
          transform: 'translateZ(0)',
          ['--tabbar-h' as string]: '0px',
          ['--sa-b' as string]: '0px',
        }}
      >
        <div style={{ padding: 'var(--s-16) var(--s-20)', display: 'flex', flexDirection: 'column', gap: 'var(--s-12)' }}>
          <p className="t-headline">Review findings</p>
          <p className="t-body">Content scrolls away beneath the row; the fade dissolves it before it reaches the action.</p>
          <p className="t-body">Shoulder imbalance · Pelvic obliquity · Forward head</p>
        </div>
        <ActionBar reason="Choose a client to continue.">
          <Button variant="secondary" size="lg" block>Later</Button>
          <Button variant="primary" size="lg" block>Start scan</Button>
        </ActionBar>
      </div>
    </Demo>
  )
}
