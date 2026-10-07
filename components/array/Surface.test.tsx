// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Surface, SurfaceButton, SurfaceLink } from './Surface'

afterEach(cleanup)

/**
 * The v3 rewrite keeps Surface's exported API unchanged (dozens of screens
 * import it) while replacing its internals — this is the regression guard
 * for that contract, not a test of the new visual recipe.
 */
describe('Surface (v3 internals, v2 API)', () => {
  it('renders children through the default tile tier', () => {
    render(<Surface>hello</Surface>)
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('still accepts tier, pad, className, style, innerClassName and innerStyle', () => {
    render(
      <Surface tier="feature" pad="snug" className="outer" style={{ marginTop: 4 }} innerClassName="inner" innerStyle={{ color: 'red' }}>
        content
      </Surface>,
    )
    const node = screen.getByText('content')
    expect(node.className).toContain('inner')
    expect(node.style.color).toBe('red')
  })

  it('SurfaceLink renders a real <a> with the given href and aria-label', () => {
    render(<SurfaceLink href="/clients/42" aria-label="Open Jordan Pierce">Jordan Pierce</SurfaceLink>)
    const link = screen.getByRole('link', { name: 'Open Jordan Pierce' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/clients/42')
  })

  it('SurfaceButton renders a real <button> and fires onClick', () => {
    const onClick = vi.fn()
    render(<SurfaceButton onClick={onClick} aria-label="Dismiss">x</SurfaceButton>)
    const button = screen.getByRole('button', { name: 'Dismiss' })
    expect(button.tagName).toBe('BUTTON')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('SurfaceButton respects disabled and aria-pressed', () => {
    render(
      <SurfaceButton disabled aria-pressed aria-label="Toggled">on</SurfaceButton>,
    )
    const button = screen.getByRole('button', { name: 'Toggled' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})
