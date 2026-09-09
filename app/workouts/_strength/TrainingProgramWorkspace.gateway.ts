import { TrainingProgramWorkspaceProjectionSchema, type TrainingProgramWorkspaceProjection, type TrainingProgramWorkspaceView } from '@/lib/training/contracts/program-workspace'

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export async function requestTrainingProgramWorkspace(input: {
  assignmentId: string
  view: TrainingProgramWorkspaceView
  cursor?: string | null
}): Promise<TrainingProgramWorkspaceProjection> {
  const query = new URLSearchParams({ view: input.view })
  if (input.cursor) query.set('cursor', input.cursor)
  const response = await fetch(`/api/training/programs/${encodeURIComponent(input.assignmentId)}/workspace?${query}`, { cache: 'no-store' })
  const body = await readJson(response)
  if (response.status === 409) throw new Error('This program changed. Reload the program to see the current schedule.')
  if (!response.ok) throw new Error('The training program could not be loaded.')
  const parsed = TrainingProgramWorkspaceProjectionSchema.safeParse(body)
  if (!parsed.success || parsed.data.assignment.assignmentId !== input.assignmentId || parsed.data.view !== input.view) {
    throw new Error('The training program response was invalid.')
  }
  return parsed.data
}
