// Reference lookup into data/exercises-dataset (gitignored, license-unresolved:
// REFERENCE ONLY — never copy its text into content files verbatim).
// Usage: node scripts/dataset-lookup.mjs "pec stretch"
import { readFileSync } from 'node:fs'

const query = (process.argv[2] ?? '').toLowerCase()
if (!query) {
  console.error('usage: node scripts/dataset-lookup.mjs "<name fragment>"')
  process.exit(1)
}
const all = JSON.parse(readFileSync('data/exercises-dataset/data/exercises.json', 'utf8'))
const hits = all.filter((e) => e.name.toLowerCase().includes(query)).slice(0, 5)
if (hits.length === 0) console.log('no match — author from the existing instructions field')
for (const h of hits) {
  console.log(`\n=== ${h.name} (${h.category} / ${h.equipment}) ===`)
  for (const [i, s] of (h.instruction_steps?.en ?? []).entries()) console.log(`${i + 1}. ${s}`)
}
