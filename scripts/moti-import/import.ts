// CLI: import the Moti-Physio screening archive into a local dataset.
//
//   npx vite-node scripts/moti-import/import.ts -- \
//     --archive "/path/to/03 - Client Screenings" [--out datasets/moti]
//
// Photos are referenced by relative filename, never copied. The output
// directory is gitignored; nothing PII-bearing is written (see decode.ts).

import { collectClients, importClient } from './walk'
import { emitDataset } from './emit'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const archive = arg('archive')
if (!archive) {
  console.error('Usage: import.ts --archive "<path to 03 - Client Screenings>" [--out <dir>]')
  process.exit(1)
}
const outDir = arg('out') ?? 'datasets/moti'

const refs = collectClients(archive)
const clients = refs.map((ref) => importClient(ref))
const index = emitDataset(clients, outDir)

console.log(
  `Imported ${index.clientCount} clients / ${index.sessionCount} sessions → ${outDir}`,
)
for (const [group, count] of Object.entries(index.groups)) {
  console.log(`  ${group}: ${count}`)
}
