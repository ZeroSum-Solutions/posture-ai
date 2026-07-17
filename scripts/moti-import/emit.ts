// Writes the imported archive as a local dataset: one JSON per client plus
// an index.json summary. The output directory is gitignored — real client
// measurement data never enters the repo.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClientDataset } from './walk'

export interface DatasetIndex {
  clientCount: number
  sessionCount: number
  groups: Record<string, number>
  clients: string[]
}

export function emitDataset(clients: ClientDataset[], outDir: string): DatasetIndex {
  const clientsDir = join(outDir, 'clients')
  mkdirSync(clientsDir, { recursive: true })

  const groups: Record<string, number> = {}
  let sessionCount = 0
  for (const client of clients) {
    groups[client.group] = (groups[client.group] ?? 0) + 1
    sessionCount += client.sessions.length
    writeFileSync(
      join(clientsDir, `${client.clientId}.json`),
      JSON.stringify(client, null, 1),
    )
  }

  const index: DatasetIndex = {
    clientCount: clients.length,
    sessionCount,
    groups,
    clients: clients.map((c) => c.clientId).sort(),
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1))
  return index
}
