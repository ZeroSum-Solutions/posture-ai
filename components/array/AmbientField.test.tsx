// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AuraTint } from './AmbientField'

afterEach(cleanup)

describe('AuraTint', () => {
  it('renders a hidden marker carrying the severity', () => {
    const { container } = render(<AuraTint severity="review" />)
    const marker = container.querySelector('[data-aura-tint]')
    expect(marker?.getAttribute('data-aura-tint')).toBe('review')
    expect(marker?.hasAttribute('hidden')).toBe(true)
  })

  it('renders nothing without a severity', () => {
    const { container } = render(<AuraTint severity={null} />)
    expect(container.innerHTML).toBe('')
  })
})
