'use client'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/ui'
import ClientForm, { type ClientPayload } from '../ClientForm'
import type { OperationMode } from '@/lib/prototype/runtime'

export default function NewClientPageClient({ operationMode, returnTo = 'clients' }: { operationMode: OperationMode; returnTo?: 'capture' | 'clients' }) {
  const router = useRouter()

  async function handleCreate(payload: ClientPayload) {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The server derives practitioner_id from the session, records the subject
      // consent from the signer fields, and stamps consent_recorded_at itself.
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to create client.')
    router.push(returnTo === 'capture' ? `/assessments/new?client_id=${encodeURIComponent(json.client.id)}` : `/clients/${encodeURIComponent(json.client.id)}`)
  }

  return (
    <div className="app-screen">
      <TopBar
        title="New client"
        subtitle={operationMode === 'prototype'
          ? 'Create a prototype record for the next posture screen.'
          : 'Create a clear record and capture consent before the first screen.'}
        back={{
          href: returnTo === 'capture' ? '/assessments/new' : '/clients',
          label: returnTo === 'capture' ? 'Back to scan' : 'Back to Clients',
        }}
      />
      <div className="app-screen-x app-stack">
        <ClientForm mode="create" operationMode={operationMode} cancelHref={returnTo === 'capture' ? '/assessments/new' : '/clients'} onSubmit={handleCreate} />
      </div>
    </div>
  )
}
