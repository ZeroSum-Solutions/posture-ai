import { cache } from 'react'
import { configuredOperationMode } from '@/lib/prototype/runtime'
import { practitionerAdmission } from '@/lib/auth/requirePractitioner'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { serverClinicalContentAccess, serverClinicalContentAccessForPractitioner } from './database'

/** Request-scoped content access for the existing application shell and pages. */
export const currentPractitionerClinicalContentAccess = cache(async () => {
  if (configuredOperationMode() !== 'prototype') return serverClinicalContentAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return serverClinicalContentAccess()
  const admission = await practitionerAdmission(supabase, user.id)
  if (admission.response) return serverClinicalContentAccess()
  return serverClinicalContentAccessForPractitioner(user.id)
})
