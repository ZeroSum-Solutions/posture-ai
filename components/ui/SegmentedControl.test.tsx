// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

const options = [
  { value: 'front' as const, label: 'Front' },
  { value: 'back' as const, label: 'Back' },
  { value: 'left' as const, label: 'Left' },
]

describe('SegmentedControl', () => {
  it('renders a radiogroup with one checked radio', () => {
    render(<SegmentedControl options={options} value="front" onChange={vi.fn()} label="Body view" />)
    expect(screen.getByRole('radiogroup', { name: 'Body view' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Front' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Back' }).getAttribute('aria-checked')).toBe('false')
  })

  it('moves selection with ArrowRight and calls onChange', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="front" onChange={onChange} label="Body view" />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Front' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('back')
  })

  it('wraps from the last option to the first with ArrowRight', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="left" onChange={onChange} label="Body view" />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Left' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('front')
  })

  it('jumps to the last option with End', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="front" onChange={onChange} label="Body view" />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Front' }), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('left')
  })

  it('calls onChange on click', () => {
    const onChange = vi.fn()
    render(<SegmentedControl options={options} value="front" onChange={onChange} label="Body view" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Back' }))
    expect(onChange).toHaveBeenCalledWith('back')
  })
})
