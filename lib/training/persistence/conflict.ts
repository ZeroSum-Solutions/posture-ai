// Business conflicts use PT409 so PostgREST does not retry them as serialization failures.
// Keep 40001 compatible with older databases and genuine database serialization failures.
export function isTrainingConflictCode(code: string | undefined): boolean {
  return code === 'PT409' || code === '40001'
}
