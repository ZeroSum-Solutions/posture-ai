'use client'

/**
 * Controls-lane demos for the component kit (/dev/kit): Button, IconButton,
 * FilterChip, SegmentedControl, Switch/Checkbox/Radio, fields and Stepper, in
 * every state, with live demos for the morphs (pending → check, label width
 * spring, chip pour, stepper stretch). Kept out of page.tsx so lanes can edit
 * the kit side by side.
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  ChipRow,
  FilterChip,
  IconButton,
  Radio,
  SearchField,
  SegmentedControl,
  Select,
  Stepper,
  Switch,
  TextField,
  Textarea,
} from '@/components/ui'

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-8)' }}>
      <p className="t-label">{label}</p>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-8)', alignItems: 'center' }}>{children}</div>
}

/* ── Button ─────────────────────────────────────────────────────────── */

function PendingDemo() {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setTimeout(() => setPhase('done'), 1600)
    return () => window.clearTimeout(timer)
  }, [phase])
  return (
    <Button
      block
      icon="check-circle-linear"
      loading={phase === 'loading'}
      success={phase === 'done'}
      onClick={() => setPhase('loading')}
    >
      Save program
    </Button>
  )
}

function DynamicLabelDemo() {
  const [count, setCount] = useState(3)
  return (
    <Row>
      <Button variant="secondary" onClick={() => setCount((n) => n + 1)}>
        {count === 1 ? 'Add 1 exercise' : count >= 10 ? `Add all ${count} exercises to this program` : `Add ${count} exercises`}
      </Button>
      <IconButton icon="minus-circle-linear" label="Fewer" onClick={() => setCount((n) => Math.max(1, n - 1))} />
    </Row>
  )
}

export function ButtonKit() {
  return (
    <>
      <Demo label="variants — primary · secondary (glass) · quiet · danger">
        <Row>
          <Button variant="primary">Start scan</Button>
          <Button variant="secondary">Compare</Button>
        </Row>
        <Row>
          <Button variant="tertiary" chevron>See all</Button>
          <Button variant="danger" icon="danger-circle-linear">Delete</Button>
        </Row>
      </Demo>
      <Demo label="sizes — sm 48 · md 52 · lg 56">
        <Row>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
      </Demo>
      <Demo label="pending — tap: pill → Lens circle → check → pill">
        <PendingDemo />
        <Row>
          <Button loading>Saving</Button>
          <Button variant="secondary" loading>Loading</Button>
        </Row>
      </Demo>
      <Demo label="label change — width springs, label rolls (tap it)">
        <DynamicLabelDemo />
      </Demo>
      <Demo label="blocked — flat plate, reason above, still focusable">
        <Button block disabledReason="Choose a client to continue">Continue</Button>
        <Row>
          <Button variant="secondary" disabledReason="Nothing to compare yet">Compare</Button>
        </Row>
      </Demo>
    </>
  )
}

/* ── IconButton ─────────────────────────────────────────────────────── */

export function IconButtonKit() {
  const [count, setCount] = useState(3)
  return (
    <>
      <Demo label="plain (canvas) · badge (tap: count re-pops) · dot · filled · blocked">
        <Row>
          <IconButton icon="bell-linear" label="Notifications" />
          <IconButton icon="bell-linear" label={`Notifications, ${count} new`} badge={count} onClick={() => setCount((n) => n + 1)} />
          <IconButton icon="calendar-linear" label="Schedule" badge />
          <IconButton icon="menu-dots-linear" label="More" variant="filled" />
          <IconButton icon="user-linear" label="Profile" disabledReason="Sign in to view your profile" />
        </Row>
      </Demo>
      <Demo label="glass — on media (camera, photos, 3D)">
        <div
          style={{
            display: 'flex',
            gap: 'var(--s-8)',
            padding: 'var(--s-16)',
            borderRadius: 'var(--r-md)',
            background: 'linear-gradient(135deg, var(--surface-3), var(--maintain-tint) 55%, var(--monitor-tint))',
          }}
        >
          <IconButton icon="close-linear" label="Close" variant="glass" />
          <IconButton icon="refresh-linear" label="Retake" variant="glass" />
          <IconButton icon="eye-linear" label="Show overlay" variant="glass" />
        </div>
      </Demo>
    </>
  )
}

/* ── FilterChip ─────────────────────────────────────────────────────── */

export function FilterChipKit() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['all']))
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <Demo label="FilterChip — selection pours in from the touch point; check draws">
      <ChipRow label="Client filters" bleed>
        <FilterChip label="All" count={28} selected={selected.has('all')} onToggle={() => toggle('all')} />
        <FilterChip label="Needs review" count={5} selected={selected.has('review')} onToggle={() => toggle('review')} />
        <FilterChip label="Overdue" icon="clock-circle-linear" selected={selected.has('overdue')} onToggle={() => toggle('overdue')} />
        <FilterChip label="Re-scan due" selected={selected.has('rescan')} onToggle={() => toggle('rescan')} />
        <FilterChip label="Score" icon="sort-vertical-linear" selected={selected.has('score')} onToggle={() => toggle('score')} />
      </ChipRow>
    </Demo>
  )
}

/* ── SegmentedControl ───────────────────────────────────────────────── */

export function SegmentedKit() {
  const [view, setView] = useState<'front' | 'side' | 'back'>('front')
  const [unit, setUnit] = useState<'kg' | 'lb'>('kg')
  const [lib, setLib] = useState<'exercises' | 'muscles'>('exercises')
  return (
    <>
      <Demo label="md · 3 options — the plate stretches toward travel">
        <SegmentedControl
          label="Body view"
          value={view}
          onChange={setView}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'side', label: 'Side' },
            { value: 'back', label: 'Back' },
          ]}
        />
      </Demo>
      <Demo label="md · icons">
        <SegmentedControl
          label="Library"
          value={lib}
          onChange={setLib}
          options={[
            { value: 'exercises', label: 'Exercises', icon: 'dumbbell-small-linear' },
            { value: 'muscles', label: 'Muscles', icon: 'pulse-2-linear' },
          ]}
        />
      </Demo>
      <Demo label="sm · inline">
        <div style={{ width: 140 }}>
          <SegmentedControl
            label="Units"
            size="sm"
            value={unit}
            onChange={setUnit}
            options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          />
        </div>
      </Demo>
    </>
  )
}

/* ── Switch, Checkbox, Radio ────────────────────────────────────────── */

export function TogglesKit() {
  const [haptics, setHaptics] = useState(true)
  const [reminders, setReminders] = useState(false)
  const [consent, setConsent] = useState(true)
  const [share, setShare] = useState(false)
  return (
    <>
      <Demo label="Switch — off bead grows into the on knob; squashes in travel">
        <Switch label="Haptics" checked={haptics} onChange={(e) => setHaptics(e.target.checked)} />
        <Switch
          label="Re-scan reminders"
          description="A nudge when a client is 30 days past their last scan"
          checked={reminders}
          onChange={(e) => setReminders(e.target.checked)}
        />
        <Switch label="Offline mode" disabled defaultChecked />
      </Demo>
      <Demo label="Checkbox — ink-1 fill blooms from the centre, check draws">
        <Checkbox label="I agree to the consent terms" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <Checkbox label="Share report with client" description="They get a link by email" checked={share} onChange={(e) => setShare(e.target.checked)} />
        <Checkbox label="Locked option" disabled />
      </Demo>
      <Demo label="Radio — ring turns ink-1, dot springs in">
        <Row>
          <Radio name="kit-radio" label="Kilograms" defaultChecked />
          <Radio name="kit-radio" label="Pounds" />
          <Radio name="kit-radio" label="Stone" disabled />
        </Row>
      </Demo>
    </>
  )
}

/* ── Fields ─────────────────────────────────────────────────────────── */

export function FieldsKit() {
  return (
    <>
      <Demo label="TextField — rest · filled · leading icon + hint · required">
        <TextField label="Client name" />
        <TextField label="Email" type="email" defaultValue="jordan@studio.co" />
        <TextField label="Next check-in" leading="calendar-linear" hint="We nudge you a week before" />
        <TextField label="Date of birth" type="date" required defaultValue="1990-04-12" />
      </Demo>
      <Demo label="error · blocked">
        <TextField label="Email" error="Enter a valid email address" defaultValue="not-an-email" />
        <TextField label="Notes" disabled disabledReason="Locked while this session syncs." defaultValue="Warm-up done" />
      </Demo>
      <Demo label="Textarea · Select">
        <Textarea label="Session notes" hint="Visible only to you" />
        <Select label="Sort by" defaultValue="score">
          <option value="score">Score</option>
          <option value="name">Name</option>
          <option value="date">Last scan</option>
        </Select>
      </Demo>
      <Demo label="SearchField — focus opens Cancel; text pops the clear button">
        <SearchField label="Search clients" placeholder="Search clients" onQueryChange={() => {}} />
        <SearchField label="Search exercises" placeholder="Search exercises" initialValue="lateral raise" onQueryChange={() => {}} />
      </Demo>
    </>
  )
}

/* ── Stepper ────────────────────────────────────────────────────────── */

const STEPS = [
  { id: 'client', label: 'Client' },
  { id: 'capture', label: 'Capture' },
  { id: 'review', label: 'Review' },
  { id: 'share', label: 'Share' },
]

export function StepperKit() {
  const [index, setIndex] = useState(1)
  return (
    <Demo label="Stepper — current pill stretches, volt now-fill sweeps; done steps tap back">
      <Stepper steps={STEPS} current={STEPS[index].id} onBack={(id) => setIndex(STEPS.findIndex((s) => s.id === id))} />
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))}>Back</Button>
        <Button size="sm" variant="secondary" onClick={() => setIndex((i) => Math.min(STEPS.length - 1, i + 1))}>Next</Button>
      </Row>
    </Demo>
  )
}
