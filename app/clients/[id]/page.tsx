import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error || !client) notFound()

  const dob = client.date_of_birth
    ? new Date(client.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Clients
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5' }}>
          {client.first_name} {client.last_name}
        </h1>
        <Link
          href={`/assessments/new?client_id=${client.id}`}
          style={{
            padding: '10px 18px', borderRadius: '8px', background: '#6366F1',
            color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
          }}
        >
          + New Assessment
        </Link>
      </div>

      <div style={{
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px', padding: '24px', marginBottom: '24px',
      }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>
          Client Information
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {dob && (
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Date of Birth</div>
              <div style={{ color: '#F5F5F5' }}>{dob}</div>
            </div>
          )}
          {client.sex_at_birth && (
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Sex at Birth</div>
              <div style={{ color: '#F5F5F5', textTransform: 'capitalize' }}>{client.sex_at_birth.replace('_', ' ')}</div>
            </div>
          )}
          {client.height_cm && (
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Height</div>
              <div style={{ color: '#F5F5F5' }}>{client.height_cm} cm</div>
            </div>
          )}
          {client.weight_kg && (
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Weight</div>
              <div style={{ color: '#F5F5F5' }}>{client.weight_kg} kg</div>
            </div>
          )}
          <div>
            <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Added</div>
            <div style={{ color: '#F5F5F5' }}>
              {new Date(client.created_at).toLocaleDateString()}
            </div>
          </div>
          {client.consent_recorded_at && (
            <div>
              <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Consent Recorded</div>
              <div style={{ color: '#10B981', fontSize: '0.875rem' }}>
                ✓ {new Date(client.consent_recorded_at).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>
        {client.notes && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '0.8rem', color: '#A1A1AA', marginBottom: '4px' }}>Notes</div>
            <div style={{ color: '#F5F5F5', fontSize: '0.9rem', lineHeight: 1.6 }}>{client.notes}</div>
          </div>
        )}
      </div>

      <div style={{
        background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px', padding: '24px',
      }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '16px' }}>
          Assessments
        </h2>
        <p style={{ color: '#A1A1AA', fontSize: '0.9rem' }}>
          No assessments yet. Click &quot;+ New Assessment&quot; to start.
        </p>
      </div>
    </div>
  )
}
