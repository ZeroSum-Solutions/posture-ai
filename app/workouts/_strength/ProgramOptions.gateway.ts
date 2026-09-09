import { TrainingProgramOptionsV1Schema } from '@/lib/training/contracts/program-options'

export async function requestProgramOptions(subjectId: string, profileRevision: number) {
  const query = new URLSearchParams({ subjectId, profileRevision: String(profileRevision) })
  const response = await fetch(`/api/training/programs/options?${query}`, { cache: 'no-store' })
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 503 && body && typeof body === 'object'
    && (body as Record<string, unknown>).error === 'program_options_unavailable') {
    throw new Error('Reviewed program catalog is not available yet.')
  }
  if (!response.ok) throw new Error('Program choices could not be loaded. Check your access or save the latest profile, then retry.')
  const options = TrainingProgramOptionsV1Schema.parse(body)
  if (options.subjectId !== subjectId || options.profileRevision !== profileRevision) {
    throw new Error('Program choices do not match the current profile. Please reload them.')
  }
  return options
}
