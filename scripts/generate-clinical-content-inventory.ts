import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildClinicalContentInventory } from '@/lib/clinical-content/inventory'

const outputUrl = new URL('../content/clinical-content-inventory.json', import.meta.url)
const outputPath = fileURLToPath(outputUrl)
const rendered = `${JSON.stringify(buildClinicalContentInventory(), null, 2)}\n`
const shouldWrite = process.argv.includes('--write')

if (shouldWrite) {
  writeFileSync(outputPath, rendered)
  process.stdout.write(`wrote ${outputPath}\n`)
} else {
  let current = ''
  try { current = readFileSync(outputPath, 'utf8') } catch { /* reported below */ }
  if (current !== rendered) {
    process.stderr.write('Clinical content inventory is stale. Run with --write and commit the result.\n')
    process.exitCode = 1
  } else {
    process.stdout.write('Clinical content inventory is current.\n')
  }
}
