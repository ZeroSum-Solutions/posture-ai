import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import { hasCompleteClinicalSurfaces } from '@/lib/clinical-content/surfaces'
import AssessmentOnlyResults from './LazyAssessmentOnlyResults'
import ClinicalAssessmentResults from './ClinicalAssessmentResults'
import { loadAssessmentResults } from './loadAssessmentResults'

export const dynamic = 'force-dynamic'

export default async function AssessmentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [access, { id }] = await Promise.all([currentPractitionerClinicalContentAccess(), params])

  if (!hasCompleteClinicalSurfaces(access)) return <AssessmentOnlyResults params={params} />
  const initialResult = await loadAssessmentResults(id, access)
  if (!initialResult.ok) return <ClinicalAssessmentResults params={params} />

  return (
    <ClinicalAssessmentResults
      params={params}
      initialAssessmentId={id}
      initialData={initialResult.data}
    />
  )
}
