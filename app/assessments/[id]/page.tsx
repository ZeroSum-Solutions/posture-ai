import { serverClinicalContentAccess } from '@/lib/clinical-content/database'
import AssessmentOnlyResults from './AssessmentOnlyResults'
import ClinicalAssessmentResults from './ClinicalAssessmentResults'

export const dynamic = 'force-dynamic'

export default async function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await serverClinicalContentAccess()
  const completeClinicalSurface = access.surfaces.recommendations
    && access.surfaces.programs
    && access.surfaces.workouts
    && access.surfaces.knowledgeLinks

  if (!completeClinicalSurface) return <AssessmentOnlyResults params={params} />
  return <ClinicalAssessmentResults params={params} />
}
