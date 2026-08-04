#!/usr/bin/env node
/**
 * Regenerate components/array/icons.ts from the Iconify Solar set.
 *
 * Icons are inlined at authoring time rather than fetched at runtime: the
 * screening flow has to render with no network, and a clinical app should not
 * depend on a third-party icon CDN being reachable.
 *
 * Usage: node scripts/generate-array-icons.mjs
 * Reads the icon names already referenced in components/array/icons.ts so the
 * set only ever shrinks or grows deliberately.
 */
import { readFile, writeFile } from 'node:fs/promises'

const TARGET = new URL('../components/array/icons.ts', import.meta.url)

const existing = await readFile(TARGET, 'utf8')
const names = [...existing.matchAll(/^ {2}'([a-z0-9-]+)':/gm)].map(match => match[1])
if (names.length === 0) throw new Error('No icon names found in components/array/icons.ts')

const response = await fetch(`https://api.iconify.design/solar.json?icons=${names.join(',')}`)
if (!response.ok) throw new Error(`Iconify responded ${response.status}`)
const payload = await response.json()
if (payload.not_found?.length) throw new Error(`Unknown icons: ${payload.not_found.join(', ')}`)

const defaultWidth = payload.width ?? 24
const defaultHeight = payload.height ?? 24
const lines = [
  '// Solar icon set (linear + one bold), inlined at authoring time.',
  '// Source: https://icon-sets.iconify.design/solar/ — CC BY 4.0, 480 Design.',
  '// Inlined deliberately: the app must render offline and must not call an icon CDN',
  '// at runtime. Regenerate with scripts/generate-array-icons.mjs.',
  '',
  'export type IconName = keyof typeof arrayIcons',
  '',
  'type IconDef = { body: string; viewBox: string }',
  '',
  'export const arrayIcons = {',
]
for (const name of names.sort()) {
  const icon = payload.icons[name]
  const width = icon.width ?? defaultWidth
  const height = icon.height ?? defaultHeight
  lines.push(`  '${name}': { body: "${icon.body.replaceAll('"', "'")}", viewBox: '0 0 ${width} ${height}' },`)
}
lines.push('} satisfies Record<string, IconDef>', '')
await writeFile(TARGET, lines.join('\n'))
console.log(`[generate-array-icons] wrote ${names.length} icons`)
