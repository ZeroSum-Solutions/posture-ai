'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { ListRowSkeleton, TopBar } from '@/components/ui'
import ClientForm, { type ClientPayload, type ClientFormInitial } from '../../ClientForm'

export default function EditClientPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [initial, setInitial] = useState<ClientFormInitial | null>(null)
  const [name, setName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      const { data, error } = await supabase
        .from('clients')
        .select('first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes')
        .eq('id', id)
        .eq('practitioner_id', user.id)
        .single()
      if (error || !data) { router.push('/clients'); return }
      setInitial(data)
      setName(`${data.first_name} ${data.last_name}`)
      setLoading(false)
    }
    load()
  }, [id, router])

  async function handleSave(payload: ClientPayload) {
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error || 'Failed to save changes.')
    router.push(`/clients/${id}`)
    router.refresh()
  }

  return (
    <div className="app-screen">
      <TopBar
        title={name ? `Edit client — ${name}` : 'Edit client'}
        subtitle="Client record"
        back={{ href: `/clients/${id}`, label: 'Back to Clients' }}
      />
      <div className="app-screen-x app-stack">
        {loading || !initial ? (
          <div role="status" aria-busy="true" aria-label="Loading client record">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : (
          <ClientForm mode="edit" initial={initial} cancelHref={`/clients/${id}`} onSubmit={handleSave} />
        )}
      </div>
    </div>
  )
}
