'use client'

import { useState } from 'react'
import ClientForm, { type ClientPayload } from '@/app/clients/ClientForm'
import type { OperationMode } from '@/lib/prototype/runtime'
import { Surface } from '@/components/array/Surface'
import { Button, Select } from '@/components/ui'
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

export default function StrengthBuilderLauncher({ clients, initialClientId, operationMode = 'governed' }: {
  clients: readonly StrengthBuilderClient[]
  initialClientId?: string | null
  operationMode?: OperationMode
}) {
  const initial = clients.some(client => client.id === initialClientId) ? initialClientId! : clients[0]?.id ?? ''
  const [selectedId, setSelectedId] = useState(initial)
  const [sampleCatalog, setSampleCatalog] = useState<'starter' | 'exercise-swap' | 'conditioning' | 'bodyweight-assistance'>('starter')
  const [sample, setSample] = useState<SampleState>({ status: 'idle' })
  const [addedClients, setAddedClients] = useState<StrengthBuilderClient[]>([])
  const [creatingClient, setCreatingClient] = useState(false)
  const allClients = [...clients, ...addedClients.filter(added => !clients.some(client => client.id === added.id))]
  const selected = allClients.find(client => client.id === selectedId)

  async function addClient(payload: ClientPayload) {
    const response = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await response.json()
    if (!response.ok || typeof body?.client?.id !== 'string' || typeof body.client.first_name !== 'string' || typeof body.client.last_name !== 'string') throw new Error('Client could not be created. Review the form and try again.')
    const client = { id: body.client.id, name: `${body.client.first_name} ${body.client.last_name}`.trim() }
    setAddedClients(current => [...current, client])
    setSelectedId(client.id)
    setSample({ status: 'idle' })
    setCreatingClient(false)
  }

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
    {selected ? <Select
      label="Build strength program for"
      className={styles.clientPicker}
      value={selected.id}
      onChange={event => { setSelectedId(event.target.value); setSample({ status: 'idle' }) }}
    >
      {allClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
    </Select> : <p className="t-body">Add a client to build a real athlete program.</p>}
    <Button variant="secondary" aria-expanded={creatingClient} onClick={() => setCreatingClient(value => !value)}>{creatingClient ? 'Close new client form' : 'New client'}</Button>
    {creatingClient && <ClientForm mode="create" operationMode={operationMode} cancelHref="/workouts" onSubmit={addClient} />}
    {sample.status !== 'ready' && selected ? <StrengthBuilderEntry key={selected.id} source={{ kind: 'client', client: selected }} /> : null}
    <Surface tier="tile" innerClassName={styles.sampleEntry}>
      <div>
        <p className="t-overline">Private practice workspace</p>
        <h2 className="t-title-2">Try a sample program</h2>
        <p className="t-body">Use a separate private practice athlete to explore the strength program builder without changing a real client.</p>
      </div>
      <Select
        label="Sample program"
        className={styles.clientPicker}
        value={sampleCatalog}
        disabled={sample.status === 'pending' || sample.status === 'ready'}
        onChange={event => { setSampleCatalog(event.target.value === 'exercise-swap' || event.target.value === 'conditioning' || event.target.value === 'bodyweight-assistance' ? event.target.value : 'starter'); setSample({ status: 'idle' }) }}
      >
        <option value="starter">Strength and conditioning</option>
        <option value="exercise-swap">Exercise alternatives</option>
        <option value="conditioning">Conditioning activities</option>
        <option value="bodyweight-assistance">Bodyweight and assisted strength</option>
      </Select>
      {sample.status === 'ready'
        ? <Button variant="secondary" onClick={() => setSample({ status: 'idle' })}>{selected ? 'Return to selected client' : 'Close sample'}</Button>
        : <Button variant="secondary" loading={sample.status === 'pending'} onClick={() => void openSample()}>{sample.status === 'pending' ? 'Preparing sample…' : 'Try a sample program'}</Button>}
      {sample.status === 'error' ? <p role="alert" className={styles.error}>{sample.message}</p> : null}
    </Surface>
    {sample.status === 'ready'
      ? <StrengthBuilderEntry key={sample.subjectId} source={{ kind: 'subject', subject: { id: sample.subjectId, name: 'Practice Athlete' } }} />
      : null}
  </section>
}
