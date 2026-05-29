import { createSupabaseServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function ExercisesPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, name, category, instructions, sets, hold_seconds, primary_deviation_keys, min_zone')
    .order('name')

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        Exercise Library
      </h1>
      {error && <p style={{ color: '#EF4444' }}>Error loading exercises: {error.message}</p>}
      {!exercises?.length && <p style={{ color: '#A1A1AA' }}>No exercises found.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {exercises?.map((ex) => (
          <div
            key={ex.id}
            style={{
              background: '#161618',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              padding: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontWeight: 600, color: '#F5F5F5' }}>{ex.name}</span>
              <span style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(99,102,241,0.15)',
                color: '#818CF8',
                textTransform: 'uppercase',
              }}>
                {ex.category}
              </span>
            </div>
            {ex.instructions && (
              <p style={{ fontSize: '0.85rem', color: '#A1A1AA', lineHeight: 1.5 }}>{ex.instructions}</p>
            )}
            {(ex.sets || ex.hold_seconds) && (
              <p style={{ fontSize: '0.8rem', color: '#6366F1', marginTop: '8px' }}>
                {ex.sets && `${ex.sets} sets`}{ex.sets && ex.hold_seconds && ' · '}{ex.hold_seconds && `${ex.hold_seconds}s hold`}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
