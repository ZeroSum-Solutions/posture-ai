// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveCalibrationOfferV1Schema } from '@/lib/training/contracts/active-calibration'
import { calibrationOffer as offer } from './activeCalibration.test-fixtures'
import Choices, { type CalibrationConfirmationOutcome } from './ActiveCalibrationChoices'

afterEach(cleanup)


describe('ActiveCalibrationChoices', () => {
  it('does not choose or apply a setting until explicit selection and confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue({ status: 'accepted', message: 'Future sessions updated.' })
    render(<Choices offer={offer()} onConfirm={confirm} />)
    expect((screen.getByRole('button', { name: 'Confirm new setting' }) as HTMLButtonElement).disabled).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: 'New setting' }), { target: { value: '1' } })
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new setting' }))
    await screen.findByText('Future sessions updated.')
    expect(confirm).toHaveBeenCalledWith({ requestId: expect.any(String), optionIndex: 1 })
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  })

  it('keeps the exact request and option after an ambiguous response', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ status: 'accepted', message: 'Previously saved change confirmed.' })
    render(<Choices offer={offer('machine_assistance')} onConfirm={confirm} />)
    expect(screen.getByRole('option', { name: '30.125 kg assistance from the machine' })).toBeTruthy()
    expect(screen.getByText(/More assistance reduces/)).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new setting' }))
    await screen.findByRole('button', { name: 'Retry the same selection' })
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same selection' }))
    await screen.findByText('Previously saved change confirmed.')
    expect(confirm.mock.calls[1][0]).toEqual(confirm.mock.calls[0][0])
  })

  it('blocks duplicate submissions while a response is in flight', async () => {
    let finish!: (value: CalibrationConfirmationOutcome) => void
    const confirm = vi.fn(() => new Promise<CalibrationConfirmationOutcome>(resolve => { finish = resolve }))
    render(<Choices offer={offer()} onConfirm={confirm} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    const form = screen.getByRole('form')
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(confirm).toHaveBeenCalledTimes(1)
    await act(async () => finish({ status: 'not_accepted', message: 'Source changed. Reload the plan.' }))
    expect(screen.getByRole('alert').textContent).toContain('Source changed')
  })

  it('resets selection when an immutable offer changes', async () => {
    const confirm = vi.fn().mockResolvedValue({ status: 'unconfirmed', message: 'Not confirmed.' })
    const original = offer('bodyweight_external')
    const view = render(<Choices offer={original} onConfirm={confirm} />)
    expect(screen.getByRole('option', { name: '0 kg added externally to bodyweight' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('Not confirmed.')
    view.rerender(<Choices offer={{ ...original, sourceBindings: { ...original.sourceBindings, sourceProgramHash: 'b'.repeat(64) } }} onConfirm={confirm} />)
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(''))
    expect(screen.queryByText('Not confirmed.')).toBeNull()
  })

  it('offers no acceptance action when no easier setting exists', () => {
    const base = offer()
    const unavailable = ActiveCalibrationOfferV1Schema.parse({
      schemaVersion: base.schemaVersion, sourceBindings: base.sourceBindings,
      currentLoad: base.currentLoad, seriesIntent: base.seriesIntent,
      kind: 'unavailable', status: 'not_offered', reason: 'no_easier_achievable_setting',
    })
    render(<Choices offer={unavailable} onConfirm={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('No easier setting')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
