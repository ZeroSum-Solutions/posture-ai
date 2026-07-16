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
  }

  return (
    <div className="app-standard-page app-standard-page--narrow">
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: 'var(--brand)', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
          &#8592; Back to Clients
        </Link>
      </div>
      <p className="app-page-kicker">Practice directory</p>
      <h1 className="app-page-heading" style={{ marginBottom: 12 }}>New client</h1>
      <p className="app-page-lede" style={{ marginBottom: 28 }}>Create a clear record and capture consent before the first screen.</p>
      <ClientForm mode="create" cancelHref="/clients" onSubmit={handleCreate} />
    </div>
  )
}
