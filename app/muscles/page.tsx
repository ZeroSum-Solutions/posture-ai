import { Disclaimer } from '@/components/Disclaimer'
import { TopBar } from '@/components/ui'
import { MuscleLibrary } from './MuscleLibrary'
import styles from './Muscles.module.css'
import { notFound } from 'next/navigation'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import { approvedClinicalMuscles } from '@/lib/clinical-content/catalog'

export const metadata = { title: 'Muscle Guide — Posture AI' }
export const dynamic = 'force-dynamic'

export default async function MusclesPage() {
  const access = await currentPractitionerClinicalContentAccess()
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
      <TopBar
        title="Muscle guide"
        subtitle={muscles.length > 0 ? `${muscles.length} muscles linked to the ten screening measures` : undefined}
      />
      <div className={`app-screen-x ${styles.body}`}>
        <MuscleLibrary muscles={muscles} />
        <footer className={styles.footer}>
          <Disclaimer compact />
        </footer>
      </div>
    </div>
  )
}
