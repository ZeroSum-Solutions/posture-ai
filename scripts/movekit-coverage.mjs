// Compares MoveKit's clip catalog against our 55 exercise names.
// Usage: node scripts/movekit-coverage.mjs data/movekit-catalog.txt
import { readFileSync, readdirSync } from 'node:fs'

const catalog = readFileSync(process.argv[2] ?? 'data/movekit-catalog.txt', 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
// Synonyms bridge PT naming vs gym naming.
const SYNONYMS = {
  'chin tucks': ['chin tuck', 'neck retraction', 'cervical retraction'],
  'wall angels': ['wall angel', 'wall slide'],
  'push up plus': ['push-up plus', 'scapular push up', 'scapula push up'],
  'prone y raise': ['y raise', 'prone y'],
  'prone t raise': ['t raise', 'prone t', 'reverse fly floor'],
  'supine pelvic tilt': ['pelvic tilt'],
  'terminal knee extension': ['tke', 'knee extension band'],
  'dead bug': ['deadbug'],
  'bird dog': ['bird-dog', 'quadruped limb raise'],
  'clamshell': ['clam shell', 'side lying clam'],
}
const files = readdirSync('content/exercises').map((f) => f.replace('.ts', ''))
const rows = files.map((slug) => {
  const name = norm(slug.replace(/-/g, ' '))
  const cands = [name, ...(SYNONYMS[name] ?? [])].map(norm)
  const hit = catalog.find((c) => cands.some((cand) => norm(c).includes(cand) || cand.includes(norm(c))))
  return { slug, hit: hit ?? null }
})
const matched = rows.filter((r) => r.hit)
console.log(`MoveKit coverage: ${matched.length}/${rows.length}`)
console.log('\n-- MISSING --')
for (const r of rows.filter((r) => !r.hit)) console.log(r.slug)
console.log('\n-- MATCHED --')
for (const r of matched) console.log(`${r.slug}  →  ${r.hit}`)
