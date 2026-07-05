// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { WhyThisBody } from './WhyThisSheet'

afterEach(() => cleanup())

describe('WhyThisBody', () => {
  it('renders the finding label, muscle name, and evidence badge', () => {
    render(
      <WhyThisBody
        findingLabel="Trunk Lean"
        exerciseName="Child's Pose Reach"
        movementAction="lengthens"
        muscles={[
          { slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', role: 'tight', confidence: 'medium' },
        ]}
      />,
    )
    expect(screen.getByText(/trunk lean/i)).toBeTruthy()
    expect(screen.getByText(/latissimus/i)).toBeTruthy()
    expect(screen.getByText(/moderately supported/i)).toBeTruthy()
  })

  it('maps confidence=high to "Well supported"', () => {
    render(
      <WhyThisBody
        findingLabel="Forward Head"
        exerciseName="Chin Tuck"
        movementAction="strengthens"
        muscles={[{ slug: 'deep-cervical-flexors', name: 'Deep Cervical Flexors', role: 'weak', confidence: 'high' }]}
      />,
    )
    expect(screen.getByText(/well supported/i)).toBeTruthy()
  })

  it('maps confidence=low to "Possible / textbook-based"', () => {
    render(
      <WhyThisBody
        findingLabel="Knee Valgus"
        exerciseName="Clamshell"
        movementAction="activates"
        muscles={[{ slug: 'gluteus-medius', name: 'Gluteus Medius', role: 'weak', confidence: 'low' }]}
      />,
    )
    expect(screen.getByText(/possible \/ textbook/i)).toBeTruthy()
  })

  it('maps undefined confidence to "Moderately supported" (ungraded = medium-equivalent)', () => {
    render(
      <WhyThisBody
        findingLabel="Trunk Lean"
        exerciseName="Lat Stretch"
        movementAction="lengthens"
        muscles={[{ slug: 'latissimus-dorsi', name: 'Latissimus Dorsi', role: 'tight', confidence: undefined }]}
      />,
    )
    expect(screen.getByText(/moderately supported/i)).toBeTruthy()
  })

  it('renders the movement action sentence', () => {
    render(
      <WhyThisBody
        findingLabel="Trunk Lean"
        exerciseName="Child's Pose Reach"
        movementAction="lengthens"
        muscles={[]}
      />,
    )
    expect(screen.getByText(/lengthens/i)).toBeTruthy()
  })

  it('0-muscle case: omits "listed above" and uses "involved in this finding" phrasing (M2/T9c)', () => {
    render(
      <WhyThisBody
        findingLabel="Pelvic Axial Rotation"
        exerciseName="Hip Flexor Stretch"
        movementAction="lengthens"
        muscles={[]}
      />,
    )
    // "listed above" must NOT appear when there are no muscles
    expect(screen.queryByText(/listed above/i)).toBeNull()
    // Fallback phrasing must appear instead
    expect(screen.getByText(/involved in this finding/i)).toBeTruthy()
  })
})
