// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Select } from './Select'

afterEach(cleanup)

describe('Select', () => {
  it('associates the label and reports the selected value', () => {
    render(
      <Select label="Unit" defaultValue="kg">
        <option value="kg">Kilograms</option>
        <option value="lb">Pounds</option>
      </Select>,
    )
    const select = screen.getByLabelText('Unit') as HTMLSelectElement
    expect(select.value).toBe('kg')
    fireEvent.change(select, { target: { value: 'lb' } })
    expect(select.value).toBe('lb')
  })
})
