'use client'

/**
 * The component gallery (DESIGN.md › 8, Phase 0). Dev-only, gated like
 * `/dev/golden-ingest`: every component from `components/ui` in (close to)
 * every state, on the real `AmbientField` background (the shell already
 * renders it behind every non-"/" route — see `fieldPolicy.ts`), at phone
 * width. This is what the coordinator screenshots to verify the system.
 *
 * A note on "pressed-looking": press feedback is a transient CSS `:active`/
 * framer `whileTap` state, not a prop. Rather than fork every component's
 * styles to fake a frozen frame, the one place it matters most (Button) gets
 * an explicit forced-pressed demo below; every other interactive component's
 * press state is better verified live (hold the mouse down) than guessed at
 * in a screenshot.
 */
import { useState } from 'react'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  Avatar,
  Badge,
  Banner,
  Card,
  ChipRow,
  Dialog,
  Disclosure,
  EmptyState,
  ErrorState,
  FilterChip,
  GradeBadge,
  ListGroup,
  ListRow,
  Readout,
  SectionHeader,
  SeverityChip,
  Sheet,
  Stat,
  Stepper,
  Surface,
  ToastProvider,
  TopBar,
  ActionBar,
  useToast,
  Button,
  IconButton,
  TextField,
  Textarea,
  SearchField,
  Select,
  SegmentedControl,
  Tabs,
  Switch,
  Checkbox,
  Radio,
  Spinner,
  BlobLoader,
  DotsBounce,
  Skeleton,
  ListRowSkeleton,
  CardSkeleton,
  ProgressBar,
  ProgressRing,
} from '@/components/ui'
import type { SeverityChipBand } from '@/components/ui'

function Section({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  return (
    <section className="app-section">
      <SectionHeader title={title} action={action} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-16)' }}>{children}</div>
    </section>
  )
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-8)' }}>
      <p className="t-caption" style={{ color: 'var(--text-3)' }}>{label}</p>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-8)', alignItems: 'center' }}>{children}</div>
}

const BANDS: SeverityChipBand[] = ['maintain', 'monitor', 'review', 'neutral']

function ToastButtons() {
  const toast = useToast()
  return (
    <Row>
      <Button size="sm" variant="secondary" onClick={() => toast.success('Scan saved')}>success</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.info('New assessment ready')}>info</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.warn('Consent expiring soon')}>warn</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.error('Could not save', { sticky: true })}>error (sticky)</Button>
      <Button size="sm" variant="secondary" onClick={() => toast.info('Program updated', { action: { label: 'Undo', onPress: () => {} } })}>with action</Button>
    </Row>
  )
}

function SheetDemo() {
  const [open, setOpen] = useState<null | 'compact' | 'medium' | 'large'>(null)
  return (
    <>
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setOpen('compact')}>compact</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('medium')}>medium</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('large')}>large</Button>
      </Row>
      <Sheet
        open={open != null}
        onOpenChange={(o) => setOpen(o ? open : null)}
        title="Lateral raise"
        detents={open ? [open] : ['medium']}
        footer={<Button block>Add to program</Button>}
      >
        <p className="t-body">3 sets · 12 reps. Raises the arm to shoulder height, working the lateral deltoid.</p>
        <p className="t-body" style={{ marginTop: 8 }}>Drag the grabber, or this header, to feel the detent snap and the velocity-based dismiss past 150px.</p>
      </Sheet>
    </>
  )
}

function DialogDemo() {
  const [open, setOpen] = useState<null | 'primary' | 'danger'>(null)
  return (
    <>
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setOpen('primary')}>confirm</Button>
        <Button size="sm" variant="secondary" onClick={() => setOpen('danger')}>danger</Button>
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
        confirm={{ label: 'Delete', tone: 'danger', onConfirm: () => setOpen(null) }}
      />
    </>
  )
}

export default function ComponentKitPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [filterA, setFilterA] = useState(true)
  const [filterB, setFilterB] = useState(false)
  const [segment, setSegment] = useState<'front' | 'back'>('front')
  const [tab, setTab] = useState<'findings' | 'program'>('findings')
  const [switchOn, setSwitchOn] = useState(true)
  const [checked, setChecked] = useState(true)
  const [disclosureOpen, setDisclosureOpen] = useState(false)

  return (
    <ToastProvider>
      <div className="app-screen app-screen-x">
        <TopBar title="Component kit" subtitle="Every components/ui primitive, in its states. Dev-only." />

        <Section title="Surface & Card">
          <Demo label="tile (flat, M0)">
            <Surface tier="tile"><p className="t-body">tier=&quot;tile&quot;</p></Surface>
          </Demo>
          <Demo label="row (flat, M0)">
            <Surface tier="row"><p className="t-body">tier=&quot;row&quot;</p></Surface>
          </Demo>
          <Demo label="feature (card glass, M1) — one per screen, max two">
            <Surface tier="feature" sheen>
              <p className="t-title-2">Hero card</p>
              <p className="t-body" style={{ color: 'var(--text-2)', marginTop: 4 }}>
                Edge-light border, inset top highlight, optional pointer-tracked sheen. Move your pointer over this card.
              </p>
            </Surface>
          </Demo>
          <Demo label="interactive (press .985) + Card with title/footer">
            <Card title="Shoulder score" tier="tile" interactive footer={<Button size="sm" variant="tertiary">See all</Button>}>
              <p className="t-body">Press this card — scale .985, instant overlay.</p>
            </Card>
          </Demo>
        </Section>

        <Section title="ListRow & ListGroup">
          <ListGroup label="Recent clients">
            <ListRow
              href="#"
              leading={<Avatar name="Jordan Pierce" size={40} />}
              title="Jordan Pierce"
              subtitle="Overdue · 42 days"
              trailing={<SeverityChip band="review" size="sm" />}
              chevron
            />
            <ListRow
              leading={<Avatar name="Tara Nkemelu" size={40} />}
              title="Tara Nkemelu"
              subtitle="Re-scan due · last seen 31 days ago"
              trailing={<SeverityChip band="monitor" size="sm" />}
              onPress={() => {}}
              chevron
            />
            <ListRow title="Static summary row (no href/onPress)" subtitle="Never a div with a click handler" />
            <ListRow title="Loading row" busy />
            <ListRow title="Disabled row" onPress={() => {}} disabled trailing={<Badge>off</Badge>} />
          </ListGroup>
        </Section>

        <Section title="Disclosure">
          <Disclosure title="Accuracy & methodology" open={disclosureOpen} onOpenChange={setDisclosureOpen}>
            <p className="t-body">How the score is calculated: a weighted deviation from the reference range per view.</p>
          </Disclosure>
        </Section>

        <Section title="Avatar">
          <Row>
            <Avatar name="Jordan Pierce" size={40} />
            <Avatar name="Tara Nkemelu" size={48} ringColor="var(--maintain)" />
            <Avatar name="Uma Castillo" size={72} ringColor="var(--review)" />
          </Row>
        </Section>

        <Section title="Banner">
          <Banner variant="info">New: compare two scans side by side.</Banner>
          <Banner variant="warn" action={{ label: 'Send consent', onPress: () => {} }}>Consent expires in 3 days.</Banner>
          <Banner variant="error">Could not reach the server. Changes are saved locally.</Banner>
          <Banner variant="success">Program assigned to Jordan Pierce.</Banner>
          <Banner variant="info" hint onDismiss={() => {}}>Stand 2m back, full body in frame.</Banner>
        </Section>

        <Section title="Chips & badges">
          <Demo label="FilterChip (selected = accent tint, not white — white stays for the one primary action)">
            <ChipRow label="Client filters">
              <FilterChip label="All" selected={filterA} onToggle={() => setFilterA((v) => !v)} count={28} />
              <FilterChip label="Needs review" selected={filterB} onToggle={() => setFilterB((v) => !v)} count={5} />
              <FilterChip label="Overdue" selected={false} onToggle={() => {}} />
              <FilterChip label="Score ↓" selected={false} onToggle={() => {}} />
            </ChipRow>
          </Demo>
          <Demo label="Badge">
            <Row><Badge>Beta</Badge><Badge>4 new</Badge></Row>
          </Demo>
          <Demo label="SeverityChip — every band, md & sm">
            <Row>
              {BANDS.map((band) => <SeverityChip key={`md-${band}`} band={band} />)}
            </Row>
            <Row>
              {BANDS.map((band) => <SeverityChip key={`sm-${band}`} band={band} size="sm" />)}
            </Row>
          </Demo>
          <Demo label="GradeBadge">
            <Row><GradeBadge grade="A" /><GradeBadge grade="C" /><GradeBadge grade="E" /><GradeBadge grade={null} /></Row>
          </Demo>
        </Section>

        <Section title="Button & IconButton">
          <Demo label="variants (md)">
            <Row>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="danger" icon="danger-circle-linear">Danger</Button>
            </Row>
          </Demo>
          <Demo label="sizes">
            <Row>
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
          </Demo>
          <Demo label="loading / disabledReason (blocked actions dim and state why, never a plain disabled)">
            <Row>
              <Button loading>Saving</Button>
            </Row>
            <Button disabledReason="Choose a client to continue">Continue</Button>
          </Demo>
          <Demo label="forced-pressed (for screenshot — real press is :active/whileTap)">
            <Button style={{ transform: 'scale(0.97)', filter: 'brightness(0.94)' }}>Pressed</Button>
          </Demo>
          <Demo label="IconButton — plain, badge, filled, blocked (disabledReason)">
            <Row>
              <IconButton icon="bell-linear" label="Notifications" />
              <IconButton icon="bell-linear" label="Notifications" badge={3} />
              <IconButton icon="menu-dots-linear" label="More" variant="filled" />
              <IconButton icon="user-linear" label="Profile" disabledReason="Sign in to view your profile" />
            </Row>
          </Demo>
        </Section>

        <Section title="Fields">
          <TextField label="Client name" placeholder="Jane Doe" />
          <TextField label="Email" error="Enter a valid email address" defaultValue="not-an-email" />
          <TextField label="Notes" disabled defaultValue="Locked while syncing" />
          <Textarea label="Session notes" placeholder="What did you observe?" />
          <SearchField label="Search clients" onQueryChange={() => {}} />
          <Select label="Sort by" defaultValue="score">
            <option value="score">Score</option>
            <option value="name">Name</option>
            <option value="date">Date</option>
          </Select>
        </Section>

        <Section title="SegmentedControl & Tabs">
          <Demo label="SegmentedControl — inline view toggle">
            <SegmentedControl
              label="Body view"
              value={segment}
              onChange={setSegment}
              options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]}
            />
          </Demo>
          <Demo label="Tabs — content panes">
            <Tabs idBase="kit-demo" label="Results sections" value={tab} onChange={setTab} options={[{ value: 'findings', label: 'Findings' }, { value: 'program', label: 'Program' }]} />
          </Demo>
        </Section>

        <Section title="Switch, Checkbox, Radio">
          <Switch label="Haptics" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
          <Checkbox label="I agree to the consent terms" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <Row>
            <Radio name="kit-radio" label="kg" defaultChecked />
            <Radio name="kit-radio" label="lb" />
          </Row>
        </Section>

        <Section title="Loaders">
          <Demo label="Spinner (16 / 24 / 40)">
            <Row><Spinner size={16} /><Spinner size={24} /><Spinner size={40} /></Row>
          </Demo>
          <Demo label="BlobLoader">
            <BlobLoader label="Analyzing posture…" steps={['Reading front view…', 'Reading back view…']} />
          </Demo>
          <Demo label="DotsBounce">
            <DotsBounce label="Saving" />
          </Demo>
          <Demo label="Skeleton — line, row, card">
            <Skeleton shape="line" lines={2} />
            <ListRowSkeleton />
            <CardSkeleton />
          </Demo>
          <Demo label="ProgressBar / ProgressRing">
            <ProgressBar value={0.6} label="Processing 3 of 4 views" />
            <div style={{ marginTop: 8 }}><ProgressRing value={0.75} label="Setup checklist" /></div>
          </Demo>
        </Section>

        <Section title="EmptyState & ErrorState">
          <Demo label="EmptyState — page">
            <Surface tier="tile" pad="flush">
              <EmptyState
                variant="inline"
                icon="users-group-rounded-linear"
                title="No clients yet"
                body="Add one to run your first scan."
                primary={{ label: 'Add client', onPress: () => {} }}
              />
            </Surface>
          </Demo>
          <Demo label="EmptyState — inline, 'No photo for this view'">
            <Surface tier="tile" pad="flush">
              <EmptyState variant="inline" icon="image-off-linear" title="No photo for this view" body="This view was not captured." secondary={{ label: 'Retake', onPress: () => {} }} />
            </Surface>
          </Demo>
          <Demo label="ErrorState — inline, with Retry and Details">
            <Surface tier="tile" pad="flush">
              <ErrorState
                variant="inline"
                title="Could not load this exercise"
                body="Check your connection and try again."
                onRetry={() => {}}
                secondary={{ label: 'Contact support', onPress: () => {} }}
                details="GET /api/clinical-content/exercises/lateral-raise → 503"
              />
            </Surface>
          </Demo>
        </Section>

        <Section title="Stat & Readout">
          <Row>
            <Stat label="Active" value={28} />
            <Stat label="Scans/wk" value={6} delta={{ value: 2, goodDirection: 'up' }} />
            <Stat label="Avg score" value={82} unit="/100" delta={{ value: -4, goodDirection: 'up' }} />
          </Row>
          <Readout label="Shoulder imbalance" value={47.2} unit="°" reference={{ min: 53, text: '≥ 53°' }} band="monitor" />
          <Readout label="Hip tilt" value={null} band="neutral" />
        </Section>

        <Section title="Stepper">
          <Stepper
            steps={[{ id: 'client', label: 'Client' }, { id: 'capture', label: 'Capture' }, { id: 'review', label: 'Review' }]}
            current="capture"
          />
        </Section>

        <Section title="Overlays — Sheet, Dialog, Toast">
          <Demo label="Sheet — compact / medium / large">
            <SheetDemo />
          </Demo>
          <Demo label="Dialog — primary / danger (role=alertdialog)">
            <DialogDemo />
          </Demo>
          <Demo label="Toast">
            <ToastButtons />
          </Demo>
        </Section>
      </div>
      <ActionBar reason="ActionBar — the one primary action per screen lives here.">
        <Button variant="primary" size="lg" block>Primary action</Button>
      </ActionBar>
    </ToastProvider>
  )
}
