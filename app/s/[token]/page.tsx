import { notFound } from 'next/navigation'
import { serverClinicalContentAccess } from '@/lib/clinical-content/database'
import ShareTokenClient from './ShareTokenClient'

export const dynamic = 'force-dynamic'

/**
 * Server-gated entry for the public workout player. Keeping the release check on
 * the server prevents a historical bearer-token URL from hydrating any workout
 * UI or issuing a token API request while this deployment is assessment-only.
 */
export default async function ShareTokenPage({ params }: { params: Promise<{ token: string }> }) {
  if (!(await serverClinicalContentAccess()).surfaces.workouts) notFound()
  const { token } = await params
  return <ShareTokenClient token={token} />
}
