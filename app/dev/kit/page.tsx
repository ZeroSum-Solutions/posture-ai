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
  Card,
  Disclosure,
  GradeBadge,
  ListGroup,
  ListRow,
  Readout,
  SectionHeader,
  SeverityChip,
  Stat,
  Surface,
  ToastProvider,
  TopBar,
  Button,
  Tabs,
  tabPanelProps,
} from '@/components/ui'
import type { SeverityChipBand } from '@/components/ui'
import { ActionBarKit, BannerKit, LoadersKit, OverlaysKit, StatesKit } from './OverlaysKit'
import { ButtonKit, FieldsKit, FilterChipKit, IconButtonKit, SegmentedKit, StepperKit, TogglesKit } from './ControlsKit'

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

export default function ComponentKitPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const [tab, setTab] = useState<'findings' | 'program'>('findings')
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
          <BannerKit />
        </Section>

        <Section title="Chips & badges">
          <FilterChipKit />
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

        <Section title="Button">
          <ButtonKit />
        </Section>

        <Section title="IconButton">
          <IconButtonKit />
        </Section>

        <Section title="Fields">
          <FieldsKit />
        </Section>

        <Section title="SegmentedControl & Tabs">
          <SegmentedKit />
          <Demo label="Tabs — content panes">
            <Tabs idBase="kit-demo" label="Results sections" value={tab} onChange={setTab} options={[{ value: 'findings', label: 'Findings' }, { value: 'program', label: 'Program' }]} />
            <div {...tabPanelProps('kit-demo', 'findings', tab === 'findings')} hidden={tab !== 'findings'} className="t-callout" style={{ paddingTop: 8 }}>Findings panel</div>
            <div {...tabPanelProps('kit-demo', 'program', tab === 'program')} hidden={tab !== 'program'} className="t-callout" style={{ paddingTop: 8 }}>Program panel</div>
          </Demo>
        </Section>

        <Section title="Switch, Checkbox, Radio">
          <TogglesKit />
        </Section>

        <Section title="Loaders">
          <LoadersKit />
        </Section>

        <Section title="EmptyState & ErrorState">
          <StatesKit />
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
          <StepperKit />
        </Section>

        <Section title="Overlays — Sheet, Dialog, Toast">
          <OverlaysKit />
        </Section>

        <Section title="ActionBar">
          <ActionBarKit />
        </Section>
      </div>
    </ToastProvider>
  )
}
