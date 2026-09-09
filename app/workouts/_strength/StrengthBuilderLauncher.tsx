'use client'

import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import StrengthBuilderEntry from './StrengthBuilderEntry'
import styles from './StrengthProgramBuilder.module.css'

export type StrengthBuilderClient = { id: string; name: string }

type SampleState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string }
  | { status: 'ready'; subjectId: string }

function isSetupProjection(value: unknown): value is { subjectId: string; profileRevision: number } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.subjectId === 'string'
    && record.subjectId.length > 0
    && Number.isInteger(record.profileRevision)
    && (record.profileRevision as number) > 0
}

export default function StrengthBuilderLauncher({ clients, initialClientId }: {
  clients: readonly StrengthBuilderClient[]
  initialClientId?: string | null
}) {
  const initial = clients.some(client => client.id === initialClientId) ? initialClientId! : clients[0]?.id ?? ''
  const [selectedId, setSelectedId] = useState(initial)
  const [sampleCatalog, setSampleCatalog] = useState<'starter' | 'exercise-swap' | 'conditioning' | 'bodyweight-assistance'>('starter')
  const [sample, setSample] = useState<SampleState>({ status: 'idle' })
  const selected = clients.find(client => client.id === selectedId)

  async function openSample() {
    setSample({ status: 'pending' })
    try {
      const setupPath = sampleCatalog === 'starter'
        ? '/api/training/simulation/setup'
        : `/api/training/simulation/setup?catalog=${sampleCatalog}`
      const response = await fetch(setupPath, { method: 'POST' })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok || !isSetupProjection(body)) throw new Error()
      setSample({ status: 'ready', subjectId: body.subjectId })
    } catch {
      setSample({ status: 'error', message: 'The sample athlete could not be prepared. Try again.' })
    }
  }

  return <section className={styles.launcher} aria-label="Strength program builder">
    {selected ? <label className={styles.clientPicker}>Build strength program for
      <select className="a-input" value={selected.id} onChange={event => { setSelectedId(event.target.value); setSample({ status: 'idle' }) }}>
        {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
    </label> : <p className="t-body">Add a client to build a real athlete program.</p>}
    <Surface tier="tile" innerClassName={styles.sampleEntry}>
      <div>
        <p className="t-kicker">Private practice workspace</p>
        <h2 className="t-headline-sm">Try a sample program</h2>
        <p className="t-body">Use a separate private practice athlete to explore the strength program builder without changing a real client.</p>
      </div>
      <label className={styles.clientPicker}>Sample program
        <select className="a-input" value={sampleCatalog} disabled={sample.status === 'pending' || sample.status === 'ready'}
          onChange={event => { setSampleCatalog(event.target.value === 'exercise-swap' || event.target.value === 'conditioning' || event.target.value === 'bodyweight-assistance' ? event.target.value : 'starter'); setSample({ status: 'idle' }) }}>
          <option value="starter">Strength and conditioning</option>
          <option value="exercise-swap">Exercise alternatives</option>
          <option value="conditioning">Conditioning activities</option>
          <option value="bodyweight-assistance">Bodyweight and assisted strength</option>
        </select>
      </label>
      {sample.status === 'ready'
        ? <button type="button" className="a-secondary" onClick={() => setSample({ status: 'idle' })}>{selected ? 'Return to selected client' : 'Close sample'}</button>
        : <button type="button" className="a-secondary" disabled={sample.status === 'pending'} onClick={() => void openSample()}>{sample.status === 'pending' ? 'Preparing sample…' : 'Try a sample program'}</button>}
      {sample.status === 'error' ? <p role="alert" className={styles.error}>{sample.message}</p> : null}
    </Surface>
    {sample.status === 'ready'
      ? <StrengthBuilderEntry key={sample.subjectId} source={{ kind: 'subject', subject: { id: sample.subjectId, name: 'Practice Athlete' } }} />
      : selected ? <StrengthBuilderEntry key={selected.id} source={{ kind: 'client', client: selected }} /> : null}
  </section>
}
