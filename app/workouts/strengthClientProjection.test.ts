import { describe, expect, it } from 'vitest'
import { projectStrengthClients } from './strengthClientProjection'

const clients = [
  { id: 'real-client', first_name: 'Alex', last_name: 'Rivera', archived_at: null },
  { id: 'simulation-client', first_name: 'Renamed', last_name: 'Fixture', archived_at: null },
  { id: 'archived-client', first_name: 'Archived', last_name: 'Athlete', archived_at: '2026-09-08T00:00:00Z' },
]

describe('projectStrengthClients', () => {
  it('excludes authoritative simulation-linked and archived clients without inspecting display copy', () => {
    expect(projectStrengthClients(clients, ['simulation-client'], true)).toEqual([
      { id: 'real-client', name: 'Alex Rivera' },
    ])
  })

  it('fails closed for the picker when simulation classification is incomplete', () => {
    expect(projectStrengthClients(clients, [], false)).toEqual([])
  })
})
