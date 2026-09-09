// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Form from './ConditioningRevisionForm'

afterEach(cleanup)
const bouts = [{ sourceBoutId: 'bout-1', modalityId: 'walk', scheduledLocalDate: '2030-01-08', acceptedDurationSeconds: 661, arrangement: 'separate' as const }]
const modalities = [{ id: 'walk', label: 'Walking', pairingAvailable: false }, { id: 'cycle', label: 'Cycling', pairingAvailable: true }]
function setup(disabled = false) {
  const onPreview = vi.fn()
  render(<Form bouts={bouts} modalities={modalities} athleteTimezone="America/Los_Angeles" disabled={disabled} onPreview={onPreview} />)
  return onPreview
}
function preview() { fireEvent.click(screen.getByRole('button', { name: 'Preview conditioning changes' })) }

describe('ConditioningRevisionForm', () => {
  it('preserves exact seconds and sends only an explicit selection', () => {
    const callback = setup()
    expect((screen.getByLabelText('Minutes') as HTMLInputElement).value).toBe('11')
    expect((screen.getByLabelText('Additional seconds') as HTMLInputElement).value).toBe('1')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-01-09' } })
    preview()
    expect(callback).toHaveBeenCalledWith({ replacementModalityId: 'walk', futureBouts: [{ sourceBoutId: 'bout-1', scheduledLocalDate: '2030-01-09', acceptedDurationSeconds: 661, arrangement: 'separate' }] })
  })
  it.each(['', '1.5', '-1', '60'])('rejects invalid additional seconds %j before requesting a preview', seconds => {
    const callback = setup()
    fireEvent.change(screen.getByLabelText('Additional seconds'), { target: { value: seconds } })
    preview()
    expect(callback).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/whole minutes/)
  })
  it('requires a new activity to stay inside its initial duration bound', () => {
    const callback = setup()
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'cycle' } })
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '21' } })
    preview()
    expect(callback).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/1 to 20 minutes/)
  })
  it('requires an explicit strength-first arrangement and supports its available activity', () => {
    const callback = setup()
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'cycle' } })
    expect((screen.getByLabelText('Arrangement') as HTMLSelectElement).value).toBe('separate')
    fireEvent.change(screen.getByLabelText('Arrangement'), { target: { value: 'paired_strength_first' } })
    preview()
    expect(callback.mock.calls[0][0].futureBouts[0].arrangement).toBe('paired_strength_first')
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'walk' } })
    preview()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/requires a separate day/)
  })
  it('prevents resubmission while a preview or acceptance is pending', () => {
    const callback = setup(true)
    preview()
    expect(callback).not.toHaveBeenCalled()
  })
})
