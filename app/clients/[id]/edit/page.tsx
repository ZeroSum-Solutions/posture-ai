'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
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
      <div className="app-screen-x app-stack" style={{ paddingTop: 24 }}>
        <div>
          <Link href={`/clients/${id}`} className="a-quiet" style={{ marginLeft: -12 }}>
            <Icon name="alt-arrow-left-linear" size={18} />
            Client
          </Link>
          <p className="t-overline" style={{ marginTop: 12 }}>Client record</p>
          <h1 className="t-title-1">
            Edit client{name ? <span style={{ color: 'var(--text-secondary)' }}> — {name}</span> : null}
          </h1>
        </div>
        {loading || !initial ? (
          <p className="t-body" role="status" aria-live="polite">Loading...</p>
        ) : (
          <ClientForm mode="edit" initial={initial} cancelHref={`/clients/${id}`} onSubmit={handleSave} />
        )}
      </div>
    </div>
  )
}
