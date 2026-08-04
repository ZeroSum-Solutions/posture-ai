import { Disclaimer } from '@/components/Disclaimer'
import { MuscleLibrary } from './MuscleLibrary'
import { notFound } from 'next/navigation'
import { serverClinicalContentAccess } from '@/lib/clinical-content/database'
import { approvedClinicalMuscles } from '@/lib/clinical-content/catalog'

export const metadata = { title: 'Muscle Guide — Posture AI' }
export const dynamic = 'force-dynamic'

export default async function MusclesPage() {
  const access = await serverClinicalContentAccess()
  if (!access.surfaces.knowledgeLinks) notFound()
  const muscles = approvedClinicalMuscles(access)
    .map((muscle) => ({
      slug: muscle.slug,
      name: muscle.name,
      region: muscle.region,
      function_text: muscle.functionText,
      reviewed_at: access.mode === 'approved' ? 'hg03-approved' : muscle.reviewedAt,
    }))
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))

  return (
    <div className="app-screen">
      <div className="app-screen-x app-stack">
        <div>
          <p className="t-kicker" style={{ marginBottom: 10 }}>Anatomy reference</p>
          <h1 className="t-headline">Muscle guide</h1>
          <p className="t-body" style={{ marginTop: 8 }}>
            Anatomy, function, and corrective exercise guidance for every muscle implicated in the
            ten postural screening measures.
          </p>
        </div>
        <Disclaimer compact />
        <MuscleLibrary muscles={muscles} />
      </div>
    </div>
  )
}
