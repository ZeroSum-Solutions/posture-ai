'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
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
    <div className="app-screen">
      <div className="app-screen-x app-stack" style={{ paddingTop: 24 }}>
        <div>
          <Link href="/clients" className="a-quiet" style={{ marginLeft: -12 }}>
            <Icon name="alt-arrow-left-linear" size={18} />
            Clients
          </Link>
          <p className="t-kicker" style={{ marginTop: 12 }}>Practice directory</p>
          <h1 className="t-headline">New client</h1>
          <p className="t-body" style={{ marginTop: 8 }}>Create a clear record and capture consent before the first screen.</p>
        </div>
        <ClientForm mode="create" cancelHref="/clients" onSubmit={handleCreate} />
      </div>
    </div>
  )
}
