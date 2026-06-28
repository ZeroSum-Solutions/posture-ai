// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, cleanup } from '@testing-library/react'
import MuscleBodyMap from './MuscleBodyMap'

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))

afterEach(() => cleanup())

describe('MuscleBodyMap', () => {
  it('renders one ellipse marker per legacy muscle that has a coordinate', () => {
    const { container } = render(
      <MuscleBodyMap tightMuscles={['quadriceps']} weakMuscles={['hamstrings']} />,
    )
    // quadriceps (front) + hamstrings (back) = 2 markers
    expect(container.querySelectorAll('ellipse')).toHaveLength(2)
  })

  it('renders nothing when there are no muscles at all', () => {
    const { container } = render(<MuscleBodyMap tightMuscles={[]} weakMuscles={[]} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('ellipse')).toHaveLength(0)
  })
})
