'use strict'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi
const OPAQUE_TOKEN = /\b(?:[A-Za-z0-9_-]{32,}|[0-9a-f]{40,})\b/g

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`
}

function normalizeReceiptPath(input) {
  let pathname = String(input || '/').split(/[?#]/, 1)[0] || '/'
  pathname = pathname.replace(/^\/consent\/[^/]+(?=\/|$)/, '/consent/:token')
  pathname = pathname.replace(/^\/clients\/(?!new(?:\/|$))[^/]+(?=\/|$)/, '/clients/:id')
  pathname = pathname.replace(/^\/assessments\/(?!new(?:\/|$))[^/]+(?=\/|$)/, '/assessments/:id')
  pathname = pathname.replace(/^\/workouts\/[^/]+(?=\/|$)/, '/workouts/:id')
  return pathname
}

function sanitizeSelector(input) {
  return String(input)
    .replace(/\/consent\/[^/"'\]\s?]+/g, '/consent/:token')
    .replace(/\/clients\/(?!new(?:[/"'\]\s?]|$))[^/"'\]\s?]+/g, '/clients/:id')
    .replace(/\/assessments\/(?!new(?:[/"'\]\s?]|$))[^/"'\]\s?]+/g, '/assessments/:id')
    .replace(/\/workouts\/[^/"'\]\s?]+/g, '/workouts/:id')
    .replace(UUID, ':id')
    .replace(OPAQUE_TOKEN, ':token')
}

function sanitizeText(input) {
  return sanitizeSelector(String(input ?? ''))
}

function releaseHash(input, length) {
  const value = String(input ?? '')
  if (!new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value)) {
    throw new Error('invalid release binding hash')
  }
  return value.toLowerCase()
}

function buildAxeReceipt({ project, surface, path, violations }) {
  const cleanViolations = violations.map(violation => ({
    id: sanitizeText(violation.id),
    impact: violation.impact ?? null,
    help: sanitizeText(violation.help),
    targets: violation.nodes
      .map(node => node.target.map(target => sanitizeSelector(target)))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  })).sort((left, right) => `${left.id}\u0000${left.impact}`.localeCompare(`${right.id}\u0000${right.impact}`))
  return {
    schema_version: 'posture-ai-axe-scan-v1',
    evidence_class: 'desktop_or_emulated_browser_automation',
    physical_device_evidence: false,
    project: sanitizeText(project),
    surface: sanitizeText(surface),
    path: normalizeReceiptPath(path),
    violations: cleanViolations,
  }
}

function bindAxeReceipt(receipt, { metadata, originatingTest }) {
  return {
    ...stableValue(receipt),
    release_binding: {
      commit: releaseHash(metadata.commit, 40),
      configuration_hash: releaseHash(metadata.configuration_hash, 64),
      inventory_id: sanitizeText(metadata.inventory_id),
      inventory_hash: releaseHash(metadata.inventory_hash, 64),
      originating_test: {
        project: sanitizeText(originatingTest.project),
        file: sanitizeText(originatingTest.file),
        title: sanitizeText(originatingTest.title),
      },
    },
  }
}

module.exports = {
  bindAxeReceipt,
  buildAxeReceipt,
  normalizeReceiptPath,
  sanitizeSelector,
  sanitizeText,
  stableJson,
  stableValue,
}
