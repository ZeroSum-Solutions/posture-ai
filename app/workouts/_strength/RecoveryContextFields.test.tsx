// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecoveryContextV1 } from '@/lib/training/contracts/recovery-context'
import { RecoveryContextFields } from './RecoveryContextFields'

afterEach(cleanup)
const value: RecoveryContextV1 = { report: {
  schemaVersion: 'recovery-context.v1', capturedAt: '2026-09-09T08:00:00Z',
  sleep: 'unknown', fatigue: 'unknown', schedule: 'unknown', illness: 'unknown',
} }

it('preserves unanswered concerns and records only the explicitly changed signal', () => {
  const onChange = vi.fn()
  render(<RecoveryContextFields value={value} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Sleep' }), { target: { value: 'concern_reported' } })
  expect(onChange).toHaveBeenCalledWith({ report: { ...value.report, sleep: 'concern_reported' } })
})

it('allows an explicit hold and an explicit return to performance review', () => {
  const onChange = vi.fn()
  const view = render(<RecoveryContextFields value={value} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: 'hold' } })
  expect(onChange).toHaveBeenLastCalledWith({ ...value, choice: 'hold' })
  view.rerender(<RecoveryContextFields value={{ ...value, choice: 'hold' }} onChange={onChange} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'What would you like to review?' }), { target: { value: '' } })
  expect(onChange).toHaveBeenLastCalledWith(value)
})
