// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Disclosure } from './Disclosure'

afterEach(cleanup)

describe('Disclosure', () => {
  it('starts collapsed and toggles aria-expanded on click', () => {
    render(
      <Disclosure title="Accuracy & methodology">
        <p>How the score is calculated.</p>
      </Disclosure>,
    )
    const trigger = screen.getByRole('button', { name: 'Accuracy & methodology' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('How the score is calculated.')).toBeTruthy()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('honours defaultOpen', () => {
    render(
      <Disclosure title="Details" defaultOpen>
        <p>Already open.</p>
      </Disclosure>,
    )
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('aria-controls points at the content region id', () => {
    render(
      <Disclosure title="Details">
        <p>Content</p>
      </Disclosure>,
    )
    const trigger = screen.getByRole('button', { name: 'Details' })
    const controls = trigger.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    fireEvent.click(trigger)
    expect(document.getElementById(controls!)).toBeTruthy()
  })
})
