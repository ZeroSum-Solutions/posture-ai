import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Disclaimer } from '@/components/Disclaimer'
import { MuscleLibrary } from './MuscleLibrary'

export const metadata = { title: 'Muscle Guide — Posture AI' }

// Reviewed-content gate: production hides entries pending clinical review;
// dev/preview show them with a badge so the library is usable during build-out.
const SHOW_UNREVIEWED =
  process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT === '1' || process.env.NODE_ENV !== 'production'

export default async function MusclesPage() {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('muscles')
    .select('slug, name, region, function_text, reviewed_at')
    .order('region')
    .order('name')
  if (!SHOW_UNREVIEWED) query = query.not('reviewed_at', 'is', null)
  const { data: muscles, error } = await query

  return (
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '8px' }}>
        Muscle Guide
      </h1>
      <p style={{ color: '#A1A1AA', fontSize: '0.9rem', marginBottom: '16px' }}>
        Anatomy, function, and corrective exercise guidance for every muscle implicated in the
        ten postural screening measures.
      </p>
      <Disclaimer compact />
      {error ? (
        <p style={{ color: '#EF4444' }}>Could not load the muscle guide: {error.message}</p>
      ) : (
        <MuscleLibrary muscles={muscles ?? []} />
      )}
    </div>
  )
}
