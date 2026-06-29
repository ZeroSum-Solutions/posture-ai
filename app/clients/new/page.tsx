'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ClientForm, { type ClientPayload } from '../ClientForm'

export default function NewClientPage() {
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
    router.push(`/clients/${json.client.id}`)
    router.refresh()
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
          &#8592; Back to Clients
        </Link>
      </div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        New Client
      </h1>
      <ClientForm mode="create" cancelHref="/clients" onSubmit={handleCreate} />
    </div>
  )
}
