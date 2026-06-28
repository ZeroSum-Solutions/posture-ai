// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, cleanup } from '@testing-library/react'
import MuscleBodyMap from './MuscleBodyMap'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string; [k: string]: unknown }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
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

  it('renders markers from links when legacy arrays are empty', () => {
    const { container } = render(
      <MuscleBodyMap
        tightMuscles={[]}
        weakMuscles={[]}
        tightLinks={[{ slug: 'tfl-it-band', name: 'TFL & IT Band' }]}
        weakLinks={[{ slug: 'gluteus-medius', name: 'Gluteus Medius' }]}
      />,
    )
    // tfl-it-band (front) + gluteus-medius (back) = 2 markers
    expect(container.querySelectorAll('ellipse')).toHaveLength(2)
    // chip labels also render from links (link path is coherent end to end)
    expect(container.querySelector('[data-testid="muscle-chip-tfl-it-band"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="muscle-chip-gluteus-medius"]')).not.toBeNull()
  })
})
