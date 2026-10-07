// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Stepper } from './Stepper'

afterEach(cleanup)

const steps = [
  { id: 'client', label: 'Client' },
  { id: 'capture', label: 'Capture' },
  { id: 'review', label: 'Review' },
]

describe('Stepper', () => {
  it('sets aria-valuetext to "Step N of M, Label" and matching aria-valuenow/max', () => {
    render(<Stepper steps={steps} current="capture" />)
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar.getAttribute('aria-valuetext')).toBe('Step 2 of 3, Capture')
    expect(progressbar.getAttribute('aria-valuenow')).toBe('2')
    expect(progressbar.getAttribute('aria-valuemax')).toBe('3')
  })

  it('shows the step name in visible text, never colour alone', () => {
    render(<Stepper steps={steps} current="review" />)
    expect(screen.getByText('Step 3 of 3 · Review')).toBeTruthy()
  })
})
