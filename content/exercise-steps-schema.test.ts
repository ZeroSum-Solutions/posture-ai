import { describe, test, expect } from 'vitest'
import { exerciseContentSchema } from './muscles/types'
import { doorwayPecStretch } from './exercises/doorway-pec-stretch'

describe('exerciseContentSchema.steps', () => {
  test('accepts a valid steps array', () => {
    const parsed = exerciseContentSchema.parse({
      ...doorwayPecStretch,
      steps: ['Stand tall in an open doorway with feet hip-width apart.', 'Rest your forearm on the frame with the elbow bent to ninety degrees.'],
    })
    expect(parsed.steps).toHaveLength(2)
  })

  test('steps is optional', () => {
    const { steps: _omit, ...rest } = { ...doorwayPecStretch, steps: undefined }
    expect(() => exerciseContentSchema.parse(rest)).not.toThrow()
  })

  test('rejects a banned term inside a step', () => {
    expect(() =>
      exerciseContentSchema.parse({
        ...doorwayPecStretch,
        steps: ['This step will treat your shoulder pain quickly today.', 'Second step keeps the array above the minimum length.'],
      }),
    ).toThrow(/Banned non-screening term/)
  })

  test('rejects a single-step array', () => {
    expect(() =>
      exerciseContentSchema.parse({ ...doorwayPecStretch, steps: ['Only one step is not a sequence worth rendering.'] }),
    ).toThrow()
  })
})
