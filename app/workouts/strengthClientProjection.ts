export type StrengthClientRow = {
  id: string
  first_name: string
  last_name: string
  archived_at: string | null
}

export type StrengthClientOption = { id: string; name: string }

export function projectStrengthClients(
  clients: readonly StrengthClientRow[],
  simulationClientIds: readonly string[],
  classificationComplete: boolean,
): StrengthClientOption[] {
  if (!classificationComplete) return []
  const simulationClients = new Set(simulationClientIds)
  return clients
    .filter(client => client.archived_at === null && !simulationClients.has(client.id))
    .map(client => ({ id: client.id, name: `${client.first_name} ${client.last_name}`.trim() }))
}
