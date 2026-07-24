export const CLIENT_ASSESSMENT_LIST_SCOPE = 'client-assessments'

export function clientAssessmentHistoryFilterKey(input: {
  clientId: string
  excludeId?: string | null
  includeFindings: boolean
  approvedOnly: boolean
  beforeAt?: string | null
}) {
  return [
    `client=${input.clientId}`,
    `exclude=${input.excludeId ?? ''}`,
    `findings=${input.includeFindings}`,
    `approved=${input.approvedOnly}`,
    `before=${input.beforeAt ?? ''}`,
  ].join('&')
}
