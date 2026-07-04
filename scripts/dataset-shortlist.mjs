// Candidate posture-relevant exercises from the reference dataset:
// bodyweight/band only, posture-adjacent categories or corrective name keywords.
// Output is a REVIEW list for Devin — nothing is imported automatically.
import { readFileSync } from 'node:fs'
const all = JSON.parse(readFileSync('data/exercises-dataset/data/exercises.json', 'utf8'))
const EQUIP = new Set(['body weight', 'band', 'resistance band', 'roller', 'stability ball'])
const CATS = new Set(['back', 'waist', 'shoulders', 'neck', 'upper legs', 'lower legs'])
const KEYWORDS = /stretch|bridge|plank|row|raise|tuck|rotation|pull-up|superman|hyperextension|good morning|bird|dead bug|clam/i
const hits = all.filter((e) => EQUIP.has(e.equipment) && (CATS.has(e.category) || KEYWORDS.test(e.name)))
console.log(`${hits.length} candidates\n`)
for (const h of hits) console.log(`${h.id}\t${h.category}\t${h.equipment}\t${h.name}\t[${h.target} / ${h.muscle_group}]`)
