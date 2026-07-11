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

  it('renders a chip with no marker for a link slug that has no coordinate (rectus-femoris)', () => {
    const { container } = render(
      <MuscleBodyMap
        tightMuscles={[]}
        weakMuscles={[]}
        tightLinks={[{ slug: 'rectus-femoris', name: 'Rectus Femoris' }]}
        weakLinks={[]}
      />,
    )
    // no coordinate → no marker, but it is NOT an empty accordion: the chip shows
    expect(container.querySelectorAll('ellipse')).toHaveLength(0)
    expect(container.querySelector('[data-testid="muscle-chip-rectus-femoris"]')).not.toBeNull()
  })

  it('routes low-confidence links to Possible named list, not Tight/Weak chips (I2)', () => {
    // HIGH tightLink → appears in Tight section (colored chip)
    // LOW tightLink → appears in Possible section, NOT Tight
    // LOW weakLink → appears in Possible section, NOT Weak
    const { container, getByText } = render(
      <MuscleBodyMap
        tightMuscles={[]}
        weakMuscles={[]}
        tightLinks={[
          { slug: 'pectoralis-major', name: 'Pectoralis Major', confidence: 'high' },
          { slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', confidence: 'low' },
        ]}
        weakLinks={[
          { slug: 'hamstrings', name: 'Hamstrings', confidence: 'low' },
        ]}
      />,
    )
    // High link renders in Tight section (red chip present, not gray)
    const highChip = container.querySelector('[data-testid="muscle-chip-pectoralis-major"]') as HTMLElement | null
    expect(highChip).not.toBeNull()
    expect(highChip?.style.color).toBe('var(--danger)')

    // Low tight link appears as gray Possible chip, NOT red Tight chip
    const lowTightChip = container.querySelector('[data-testid="muscle-chip-latissimus-dorsi"]') as HTMLElement | null
    expect(lowTightChip).not.toBeNull()
    expect(lowTightChip?.style.color).toBe('var(--text-secondary)')

    // Low weak link appears as gray Possible chip, NOT blue Weak chip
    const lowWeakChip = container.querySelector('[data-testid="muscle-chip-hamstrings"]') as HTMLElement | null
    expect(lowWeakChip).not.toBeNull()
    expect(lowWeakChip?.style.color).toBe('var(--text-secondary)')

    // "Possible" header exists
    expect(getByText('Possible')).toBeTruthy()
  })
})
