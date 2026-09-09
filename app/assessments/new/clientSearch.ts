export type SearchableAssessmentClient = {
  id: string
  first_name: string
  last_name: string
}

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function subsequenceScore(query: string, candidate: string) {
  if (query.length < 3) return null
  let queryIndex = 0
  let gaps = 0
  let lastMatch = -1
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue
    if (lastMatch >= 0) gaps += index - lastMatch - 1
    lastMatch = index
    queryIndex += 1
  }
  return queryIndex === query.length ? 6 + gaps + candidate.length - query.length : null
}

function tokenScore(query: string, words: string[]) {
  let best: number | null = null
  for (const word of words) {
    const score = word === query ? 0
      : word.startsWith(query) ? 1 + word.length - query.length
      : word.includes(query) ? 4 + word.indexOf(query)
      : subsequenceScore(query, word)
    if (score !== null && (best === null || score < best)) best = score
  }
  return best
}

function clientScore(client: SearchableAssessmentClient, query: string) {
  const normalized = normalizeName(`${client.first_name} ${client.last_name}`)
  const reverse = normalizeName(`${client.last_name} ${client.first_name}`)
  const words = [...new Set([...normalized.split(' '), normalized, reverse])]
  const tokens = normalizeName(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return 0
  let total = 0
  for (const token of tokens) {
    const score = tokenScore(token, words)
    if (score === null) return null
    total += score
  }
  return total
}

/**
 * Fuzzy matching is deliberately local to the already-authorized, bounded
 * client page. Server results remain the authority for matches outside that
 * page and are merged without exposing or fetching an unbounded directory.
 */
export function mergeAndRankClientMatches<T extends SearchableAssessmentClient>(
  recentClients: readonly T[],
  serverMatches: readonly T[],
  query: string,
) {
  const merged = new Map<string, { client: T; order: number; serverMatch: boolean }>()
  recentClients.forEach((client, order) => merged.set(client.id, { client, order, serverMatch: false }))
  serverMatches.forEach((client, order) => {
    const existing = merged.get(client.id)
    merged.set(client.id, { client, order: existing?.order ?? recentClients.length + order, serverMatch: true })
  })
  return [...merged.values()]
    .map((entry) => ({ ...entry, score: clientScore(entry.client, query) }))
    .filter((entry) => entry.score !== null || entry.serverMatch)
    .sort((left, right) => (left.score ?? 1_000) - (right.score ?? 1_000) || left.order - right.order)
    .map((entry) => entry.client)
}
