// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabStrip } from './Tabs'

afterEach(cleanup)

describe('TabStrip', () => {
  it('keeps the full accessible name when a compact visible label is supplied', () => {
    render(<TabStrip
      idBase="training"
      label="Training setup"
      value="profile"
      onChange={vi.fn()}
      options={[
        { value: 'profile', label: 'Profile' },
        { value: 'starting-loads', label: 'Starting loads', displayLabel: 'Loads' },
      ]}
    />)

    expect(screen.getByRole('tab', { name: 'Profile' }).textContent).toBe('Profile')
    expect(screen.getByRole('tab', { name: 'Starting loads' }).textContent).toBe('Loads')
  })
})
