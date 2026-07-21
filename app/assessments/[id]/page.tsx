import { serverClinicalContentAccess } from '@/lib/clinical-content/database'
import { hasCompleteClinicalSurfaces } from '@/lib/clinical-content/surfaces'
import AssessmentOnlyResults from './AssessmentOnlyResults'
import ClinicalAssessmentResults from './ClinicalAssessmentResults'

export const dynamic = 'force-dynamic'

export default async function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await serverClinicalContentAccess()

  if (!hasCompleteClinicalSurfaces(access)) return <AssessmentOnlyResults params={params} />
  return <ClinicalAssessmentResults params={params} />
}
