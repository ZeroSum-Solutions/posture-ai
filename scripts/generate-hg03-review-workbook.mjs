import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const inventoryPath = resolve(root, 'content/clinical-content-inventory.json')
const outputDir = resolve(root, 'docs/qa/hg03')
const outputPath = resolve(outputDir, 'review-items.csv')

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

const rows = [
  [
    'item_id',
    'item_kind',
    'item_slug',
    'item_sha256',
    'review_status',
    'reviewer_note_sha256',
    'reviewer_notes',
  ],
  ...inventory.items.map((item) => [
    item.id,
    item.kind,
    item.slug,
    item.sha256,
    '',
    '',
    '',
  ]),
]

await mkdir(outputDir, { recursive: true })
await writeFile(
  outputPath,
  `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`,
)

console.log(
  `[hg03-review-workbook] wrote ${inventory.items.length} items for ${inventory.inventory_sha256} -> ${outputPath}`,
)
