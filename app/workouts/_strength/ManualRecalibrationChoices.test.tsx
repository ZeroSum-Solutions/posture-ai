// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualRecalibrationOfferV1Schema } from '@/lib/training/contracts/manual-recalibration'
import Choices, { type ManualCalibrationConfirmationOutcome } from './ManualRecalibrationChoices'
import { manualRecalibrationOffer as offer } from './manualRecalibration.test-fixtures'

afterEach(cleanup)

describe('ManualRecalibrationChoices', () => {
  it('requires explicit selection, but exact 20% does not require the outlier checkbox', async () => {
    const confirm = vi.fn().mockResolvedValue({ status: 'accepted', message: 'Setting saved.' })
    render(<Choices offer={offer()} onConfirm={confirm} />)
    expect(screen.getByText('Last comparable recorded load: 30 kg total barbell load.')).toBeTruthy()
    fireEvent.submit(screen.getByRole('form'))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('Setting saved.')
    expect(confirm).toHaveBeenCalledWith({ requestId: expect.any(String), optionIndex: 0, outlierAcknowledged: false })
  })

  it('requires acknowledgement above 20% and freezes it with the exact retry envelope', async () => {
    const confirm = vi.fn().mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ status: 'accepted', message: 'Saved result recovered.' })
    render(<Choices offer={offer()} onConfirm={confirm} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.submit(screen.getByRole('form'))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByRole('button', { name: 'Retry the same selection' })
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole('form'))
    await screen.findByText('Saved result recovered.')
    expect(confirm.mock.calls[0][0]).toMatchObject({ optionIndex: 1, outlierAcknowledged: true })
    expect(confirm.mock.calls[1][0]).toBe(confirm.mock.calls[0][0])
  })

  it('does not carry acknowledgement to a different option or immutable offer', () => {
    const original = offer()
    const view = render(<Choices offer={original} onConfirm={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    view.rerender(<Choices offer={{ ...original, sourceBindings: { ...original.sourceBindings, sourceProgramHash: 'b'.repeat(64) } }} onConfirm={vi.fn()} />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('explains lower assistance correctly and suppresses duplicate in-flight submission', async () => {
    let finish!: (value: ManualCalibrationConfirmationOutcome) => void
    const confirm = vi.fn(() => new Promise<ManualCalibrationConfirmationOutcome>(resolve => { finish = resolve }))
    render(<Choices offer={offer('machine_assistance')} onConfirm={confirm} />)
    expect(screen.getByText(/Less assistance increases the resistance you supply/)).toBeTruthy()
    expect(screen.getByRole('option', { name: '25.125 kg assistance from the machine' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.submit(screen.getByRole('form'))
    fireEvent.submit(screen.getByRole('form'))
    expect(confirm).toHaveBeenCalledTimes(1)
    await act(async () => finish({ status: 'not_accepted', message: 'Program changed. Reload it.' }))
    expect(screen.getByRole('alert').textContent).toContain('Program changed')
  })

  it('has no accept control when equipment offers no harder setting', () => {
    const { options: _options, ...base } = offer() as Extract<ReturnType<typeof offer>, { kind: 'options' }>
    const unavailable = ManualRecalibrationOfferV1Schema.parse({ ...base, kind: 'unavailable', status: 'not_offered', reason: 'no_harder_achievable_setting' })
    render(<Choices offer={unavailable} onConfirm={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('No higher-resistance setting')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
