import { describe, expect, it } from 'vitest'
import { createLoadQuantity, derivePairedTotal } from './quantity'

describe('createLoadQuantity', () => {
  it('converts pounds to canonical kilograms with the exact PRD factor', () => {
    expect(createLoadQuantity({ value: '100', unit: 'lb' })).toEqual({
      entered: { value: '100', unit: 'lb' },
      canonicalKg: '45.359237',
    })
  })

  it.each([
    [{ value: '0', unit: 'kg' as const }, '0'],
    [{ value: '0.001', unit: 'kg' as const }, '0.001'],
    [{ value: '12.500', unit: 'kg' as const }, '12.5'],
    [{ value: '0.001', unit: 'lb' as const }, '0.00045359237'],
    [{ value: '2.5', unit: 'lb' as const }, '1.133980925'],
    [{ value: '999.999', unit: 'lb' as const }, '453.59191640763'],
    [{ value: '1', unit: 'lb' as const }, '0.45359237'],
    [{ value: '999999999999.999', unit: 'kg' as const }, '999999999999.999'],
  ])('canonicalizes $value $unit without floating-point drift', (entered, canonicalKg) => {
    expect(createLoadQuantity(entered).canonicalKg).toBe(canonicalKg)
  })

  it('preserves the entered decimal and unit without mutating the input', () => {
    const entered = { value: '12.500', unit: 'lb' as const }

    const quantity = createLoadQuantity(entered)

    expect(quantity.entered).toEqual({ value: '12.500', unit: 'lb' })
    expect(entered).toEqual({ value: '12.500', unit: 'lb' })
    expect(quantity.entered).not.toBe(entered)
  })

  it('freezes the returned quantity and its preserved entry', () => {
    const quantity = createLoadQuantity({ value: '12.5', unit: 'kg' })

    expect(Object.isFrozen(quantity)).toBe(true)
    expect(Object.isFrozen(quantity.entered)).toBe(true)
    expect(() => {
      (quantity as { canonicalKg: string }).canonicalKg = '99'
    }).toThrow(TypeError)
    expect(() => {
      (quantity.entered as { value: string }).value = '99'
    }).toThrow(TypeError)
  })

  it.each(['', '-1', '+1', '.5', '1.', '1e2', 'NaN', 'Infinity', '1.0000']) (
    'rejects unsupported entered decimal %j',
    value => {
      expect(() => createLoadQuantity({ value, unit: 'kg' }))
        .toThrow('Load value must be an unsigned decimal with at most three fractional digits')
    },
  )

  it('rejects an unsupported unit at runtime', () => {
    expect(() => createLoadQuantity({ value: '10', unit: 'stone' as 'kg' }))
      .toThrow('Load unit must be kg or lb')
  })

  it('rejects non-string runtime input with an explicit stable error', () => {
    expect(() => createLoadQuantity({ value: 10 as unknown as string, unit: 'kg' }))
      .toThrow('Load value must be a string')
  })

  it('bounds lexical input before parsing and does not echo the supplied value', () => {
    const oversized = 'x'.repeat(10_000)

    expect(() => createLoadQuantity({ value: oversized, unit: 'kg' }))
      .toThrow('Load value exceeds 16 characters')
    try {
      createLoadQuantity({ value: oversized, unit: 'kg' })
    } catch (error) {
      expect((error as Error).message).not.toContain(oversized)
      expect((error as Error).message.length).toBeLessThan(100)
    }
  })

  it('rejects more than twelve integer digits even without a fraction', () => {
    expect(() => createLoadQuantity({ value: '1000000000000', unit: 'kg' }))
      .toThrow('Load value has more than 12 integer digits')
  })
})

describe('derivePairedTotal', () => {
  it('doubles a per-side plate value without changing the stored entry', () => {
    const perSide = createLoadQuantity({ value: '0.25', unit: 'kg' })

    expect(derivePairedTotal(perSide)).toEqual({ totalKg: '0.5', source: perSide })
    expect(perSide).toEqual({
      entered: { value: '0.25', unit: 'kg' },
      canonicalKg: '0.25',
    })
  })

  it('keeps a per-hand dumbbell entry distinct from its opt-in pair total', () => {
    const perHand = createLoadQuantity({ value: '12.5', unit: 'kg' })

    expect(perHand.entered.value).toBe('12.5')
    expect(derivePairedTotal(perHand)).toEqual({ totalKg: '25', source: perHand })
    expect(perHand.entered.value).toBe('12.5')
  })

  it.each([
    ['0', '0'],
    ['0.001', '0.00090718474'],
    ['1', '0.90718474'],
    ['2.5', '2.26796185'],
  ])('doubles %s lb from its exact preserved entry', (value, totalKg) => {
    const source = createLoadQuantity({ value, unit: 'lb' })

    expect(derivePairedTotal(source)).toEqual({ totalKg, source })
  })

  it('recomputes from preserved entry instead of trusting a forged canonical value', () => {
    const forged = {
      entered: { value: '10', unit: 'kg' as const },
      canonicalKg: '100',
    }

    const paired = derivePairedTotal(forged)

    expect(paired).toEqual({
      totalKg: '20',
      source: createLoadQuantity({ value: '10', unit: 'kg' }),
    })
    expect(paired.source).not.toBe(forged)
  })
})
