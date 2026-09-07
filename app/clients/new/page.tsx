import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import NewClientPageClient from './NewClientPageClient'

export const dynamic = 'force-dynamic'

export default async function NewClientPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  return <NewClientPageClient operationMode={operationForPractitioner(user.id).mode} />
}
