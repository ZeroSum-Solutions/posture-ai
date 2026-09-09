// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ManualRoutineEditor from './ManualRoutineEditor'

const goblet = {
  id: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69',
  name: 'Dumbbell Goblet Squat', category: 'legs', equipment: ['Dumbbell'],
  instructions: 'Hold one dumbbell at chest height and squat with control.',
  media: null,
  source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/203/', author: 'Source author', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
}
const walk = {
  ...goblet,
  id: 'wger:49650b14-9b3e-4d48-a43e-f8084970632a', name: 'Continuous Walking', category: 'cardio', equipment: [],
  instructions: 'Walk continuously for the duration you choose.',
}

afterEach(cleanup)

describe('ManualRoutineEditor', () => {
  it('keeps stable item IDs while ordering user-authored strength and conditioning dosage', async () => {
    const save = vi.fn().mockResolvedValue({ routineId: '30000000-0000-4000-8000-000000000001' })
    render(<ManualRoutineEditor exercises={[goblet, walk]} availableExercises={[goblet, walk]} onSave={save} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: 'Saturday basics' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sets for Dumbbell Goblet Squat' }), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reps for Dumbbell Goblet Squat' }), { target: { value: '10' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Load for Dumbbell Goblet Squat' }), { target: { value: '12.5' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Duration in seconds for Continuous Walking' }), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move Continuous Walking up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const input = save.mock.calls[0][0]
    expect(input).toMatchObject({
      title: 'Saturday basics',
      items: [
        { referenceExerciseId: walk.id, kind: 'conditioning', durationSeconds: 900 },
        { referenceExerciseId: goblet.id, kind: 'strength', sets: 4, reps: 10, load: { value: '12.5', unit: 'kg' } },
      ],
    })
    expect(input.items.every((item: { itemId: string }) => /^[0-9a-f-]{36}$/i.test(item.itemId))).toBe(true)
  })

  it('keeps source instructions and attribution visible and reports a failed save', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Routine could not be saved.'))
    render(<ManualRoutineEditor exercises={[goblet]} onSave={save} />)

    expect(screen.getByText(goblet.instructions)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Source for Dumbbell Goblet Squat' }).getAttribute('href')).toBe(goblet.source.recordUrl)
    fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: 'Basics' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sets for Dumbbell Goblet Squat' }), { target: { value: '3' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reps for Dumbbell Goblet Squat' }), { target: { value: '8' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Load for Dumbbell Goblet Squat' }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Routine could not be saved.')
  })

  it('searches the full reference collection and preserves an exact valid decimal string', async () => {
    const save = vi.fn().mockResolvedValue({ routineId: '30000000-0000-4000-8000-000000000001' })
    render(<ManualRoutineEditor exercises={[]} availableExercises={[goblet, walk]} onSave={save} />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search all reference exercises' }), { target: { value: 'goblet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Dumbbell Goblet Squat' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Routine name' }), { target: { value: 'Exact load' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Sets for Dumbbell Goblet Squat' }), { target: { value: '3' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reps for Dumbbell Goblet Squat' }), { target: { value: '8' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Load for Dumbbell Goblet Squat' }), { target: { value: '0012.500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].items[0].load.value).toBe('0012.500')
  })

  it('preserves a saved sub-minute conditioning duration when editing', async () => {
    const save = vi.fn().mockResolvedValue({ routineId: '30000000-0000-4000-8000-000000000001' })
    render(<ManualRoutineEditor
      exercises={[]}
      initialTitle="Short walk"
      initialItems={[{
        itemId: '54000000-0000-4000-8000-000000000002', referenceExerciseId: walk.id,
        kind: 'conditioning', durationSeconds: 30, exerciseDisplay: walk,
      }]}
      onSave={save}
    />)

    expect((screen.getByRole('spinbutton', { name: 'Duration in seconds for Continuous Walking' }) as HTMLInputElement).value).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].items[0].durationSeconds).toBe(30)
  })

  it('freezes the draft controls while an ambiguous create attempt is unresolved', () => {
    render(<ManualRoutineEditor exercises={[goblet]} onSave={vi.fn()} disabled />)

    expect((screen.getByRole('textbox', { name: 'Routine name' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('searchbox', { name: 'Search all reference exercises' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove Dumbbell Goblet Squat' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save routine' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
