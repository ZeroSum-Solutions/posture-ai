import { describe, expect, it } from 'vitest'
import { mergeAndRankClientMatches } from './clientSearch'

const clients = [
  { id: '1', first_name: 'Alex', last_name: 'Rivera', date_of_birth: null },
  { id: '2', first_name: 'Morgan', last_name: 'Lee', date_of_birth: null },
  { id: '3', first_name: 'Álvaro', last_name: 'Smith-Jones', date_of_birth: null },
]

describe('assessment client fuzzy search', () => {
  it('matches name prefixes, punctuation-normalized names, and bounded subsequences', () => {
    expect(mergeAndRankClientMatches(clients, [], 'alx').map(client => client.id)).toEqual(['1'])
    expect(mergeAndRankClientMatches(clients, [], 'alvaro smi').map(client => client.id)).toEqual(['3'])
    expect(mergeAndRankClientMatches(clients, [], 'rvera').map(client => client.id)).toEqual(['1'])
  })

  it('merges server matches without duplicates and keeps stronger local matches first', () => {
    const server = [clients[0], { id: '4', first_name: 'Alexa', last_name: 'Stone', date_of_birth: null }]
    expect(mergeAndRankClientMatches(clients, server, 'alex').map(client => client.id)).toEqual(['1', '4'])
  })

  it('does not make short or unrelated queries into broad matches', () => {
    expect(mergeAndRankClientMatches(clients, [], 'ae')).toEqual([])
    expect(mergeAndRankClientMatches(clients, [], 'zzzz')).toEqual([])
  })
})
