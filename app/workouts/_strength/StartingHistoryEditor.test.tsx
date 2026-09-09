// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StartingHistoryEditor } from './StartingHistoryEditor'
import type { StartingHistoryExerciseOption } from './StartingHistory.model'

afterEach(cleanup)
const options: StartingHistoryExerciseOption[] = [{
  exerciseVersionId: 'press.v1', label: 'Floor press',
  equipmentOptions: [{ equipmentId: 'db', basis: 'dumbbell_per_hand', unit: 'lb' }],
}]

const bodyweightOptions: StartingHistoryExerciseOption[] = [{
  exerciseVersionId: 'pullup.v1', label: 'Pull-up',
  equipmentOptions: [
    { equipmentId: 'belt', basis: 'bodyweight_external', unit: 'kg' },
    { equipmentId: 'assist', basis: 'machine_assistance', unit: 'kg' },
  ],
}]

describe('StartingHistoryEditor', () => {
  it('requires explicit exercise and equipment choices before adding exact recalled context', () => {
    const onChange = vi.fn()
    render(<StartingHistoryEditor options={options} entries={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recent set' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Exercise'), { target: { value: 'press.v1' } })
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: JSON.stringify(['db', 'dumbbell_per_hand', 'lb']) } })
    fireEvent.change(screen.getByLabelText('Load (lb)'), { target: { value: '4.125' } })
    fireEvent.change(screen.getByLabelText('Repetitions'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add recent set' }))
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      exerciseVersionId: 'press.v1', reps: 7, progressionEvidenceEligible: false,
      equipmentLoad: { quantity: { entered: { value: '4.125', unit: 'lb' } } },
      source: { kind: 'recalled' }, performedAt: null,
    })
  })
  it('does not offer entry without available catalog options', () => {
    render(<StartingHistoryEditor options={[]} entries={[]} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Add recent set' })).toBeNull()
    expect(screen.getByText(/compatible equipment are available/)).toBeTruthy()
  })
  it('does not reinterpret an entered load when refreshed equipment changes units', () => {
    const onChange = vi.fn()
    const view = render(<StartingHistoryEditor options={options} entries={[]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Exercise'), { target: { value: 'press.v1' } })
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: JSON.stringify(['db', 'dumbbell_per_hand', 'lb']) } })
    fireEvent.change(screen.getByLabelText('Load (lb)'), { target: { value: '4.125' } })
    fireEvent.change(screen.getByLabelText('Repetitions'), { target: { value: '7' } })
    view.rerender(<StartingHistoryEditor options={[{ ...options[0], equipmentOptions: [{ equipmentId: 'db', basis: 'dumbbell_per_hand', unit: 'kg' }] }]} entries={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add recent set' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Choose an exercise and its equipment first')
  })

  it.each([
    ['bodyweight_external', 'belt', '0', 'added external load', /body mass is not added/],
    ['machine_assistance', 'assist', '25', 'assistance provided by the machine', /nonnegative assistance setting/],
  ] as const)('records exact %s recalled context without signed or body-mass arithmetic', (basis, equipmentId, load, label, help) => {
    const onChange = vi.fn()
    render(<StartingHistoryEditor options={bodyweightOptions} entries={[]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Exercise'), { target: { value: 'pullup.v1' } })
    fireEvent.change(screen.getByLabelText('Equipment'), {
      target: { value: JSON.stringify([equipmentId, basis, 'kg']) },
    })
    expect(screen.getByRole('option', { name: `${equipmentId} · ${label} · kg` })).toBeTruthy()
    expect(screen.getByText(help)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Load (kg)'), { target: { value: load } })
    fireEvent.change(screen.getByLabelText('Repetitions'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add recent set' }))
    expect(onChange.mock.calls[0][0][0]).toMatchObject({
      equipmentLoad: { equipmentId, basis, quantity: { entered: { value: load, unit: 'kg' } } },
    })
  })
})
