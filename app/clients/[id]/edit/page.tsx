'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
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
    <div style={{ padding: '24px 16px', maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href={`/clients/${id}`} style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>
          &#8592; Back to Client
        </Link>
      </div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        Edit Client{name ? <span style={{ color: '#A1A1AA', fontWeight: 400 }}> — {name}</span> : null}
      </h1>
      {loading || !initial ? (
        <p style={{ color: '#A1A1AA' }}>Loading...</p>
      ) : (
        <ClientForm mode="edit" initial={initial} cancelHref={`/clients/${id}`} onSubmit={handleSave} />
      )}
    </div>
  )
}
