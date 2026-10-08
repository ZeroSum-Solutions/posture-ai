// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('offers only completed steps as Back targets, and only with onBack', () => {
    const onBack = vi.fn()
    const { rerender } = render(<Stepper steps={steps} current="review" onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Client' }))
    expect(onBack).toHaveBeenCalledWith('client')
    expect(screen.queryByRole('button', { name: 'Back to Review' })).toBeNull()

    rerender(<Stepper steps={steps} current="review" />)
    expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull()
  })
})
