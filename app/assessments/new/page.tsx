import { createSupabaseServerClient } from '@/lib/supabase/server'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { NewAssessmentWizard } from './NewAssessmentWizard'

export default async function NewAssessmentPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const operationMode = user ? operationForPractitioner(user.id).mode : 'governed'

  return <NewAssessmentWizard operationMode={operationMode} />
}
