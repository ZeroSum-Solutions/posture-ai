// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Switch } from './Switch'
import { Checkbox } from './Checkbox'
import { Radio } from './Radio'

afterEach(cleanup)

describe('Switch', () => {
  it('toggles when the label is clicked, not only the control itself', () => {
    render(<Switch label="Haptics" defaultChecked={false} />)
    const input = screen.getByRole('switch', { name: 'Haptics' }) as HTMLInputElement
    expect(input.checked).toBe(false)

    fireEvent.click(screen.getByText('Haptics'))
    expect(input.checked).toBe(true)
  })
})

describe('Checkbox', () => {
  it('toggles when the label is clicked', () => {
    render(<Checkbox label="I agree to the terms" defaultChecked={false} />)
    const input = screen.getByRole('checkbox', { name: 'I agree to the terms' }) as HTMLInputElement
    expect(input.checked).toBe(false)

    fireEvent.click(screen.getByText('I agree to the terms'))
    expect(input.checked).toBe(true)
  })
})

describe('Radio', () => {
  it('toggles when the label is clicked', () => {
    render(
      <>
        <Radio name="unit" label="Kilograms" value="kg" defaultChecked={false} />
        <Radio name="unit" label="Pounds" value="lb" defaultChecked={false} />
      </>,
    )
    const kg = screen.getByRole('radio', { name: 'Kilograms' }) as HTMLInputElement
    fireEvent.click(screen.getByText('Pounds'))
    const lb = screen.getByRole('radio', { name: 'Pounds' }) as HTMLInputElement
    expect(lb.checked).toBe(true)
    expect(kg.checked).toBe(false)
  })
})
