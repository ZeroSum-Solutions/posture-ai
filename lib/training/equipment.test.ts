import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from './quantity'
import { findNextEquipmentLoad, type EquipmentInventory, type EquipmentLoad } from './equipment'

function currentLoad(
  value: string,
  unit: 'kg' | 'lb',
  basis: EquipmentLoad['basis'],
  equipmentId: string,
): EquipmentLoad {
  return { equipmentId, basis, quantity: createLoadQuantity({ value, unit }) }
}

describe('findNextEquipmentLoad', () => {
  it('includes the configured bar and collars and pairs plates symmetrically', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '20',
      collarsTotalWeight: '0.5',
      plates: [
        { value: '20', count: 2 },
        { value: '1', count: 2 },
        { value: '0.25', count: 2 },
      ],
    }

    expect(findNextEquipmentLoad(currentLoad('60.5', 'kg', 'barbell_total', 'rack-a'), inventory)).toEqual({
      equipmentId: 'rack-a',
      basis: 'barbell_total',
      quantity: createLoadQuantity({ value: '61', unit: 'kg' }),
    })
  })

  it('combines duplicate plate denominations before forming pairs', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '20',
      collarsTotalWeight: '0',
      plates: [
        { value: '0.25', count: 1 },
        { value: '0.250', count: 1 },
      ],
    }

    expect(findNextEquipmentLoad(currentLoad('20', 'kg', 'barbell_total', 'rack-a'), inventory)?.quantity)
      .toEqual(createLoadQuantity({ value: '20.5', unit: 'kg' }))
  })

  it('does not use an unpaired odd plate', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '20',
      collarsTotalWeight: '0',
      plates: [{ value: '0.25', count: 1 }],
    }

    expect(findNextEquipmentLoad(currentLoad('20', 'kg', 'barbell_total', 'rack-a'), inventory)).toBeNull()
  })

  it('selects the smallest explicit dumbbell load per hand within the exact five-percent cap', () => {
    const inventory: EquipmentInventory = {
      kind: 'dumbbell',
      equipmentId: 'db-set-a',
      unit: 'kg',
      perHandLoads: ['21', '20', '20.5', '20.500'],
    }

    expect(findNextEquipmentLoad(currentLoad('20', 'kg', 'dumbbell_per_hand', 'db-set-a'), inventory)).toEqual({
      equipmentId: 'db-set-a',
      basis: 'dumbbell_per_hand',
      quantity: createLoadQuantity({ value: '20.5', unit: 'kg' }),
    })
  })

  it('accepts an increment exactly at five percent and rejects a larger one', () => {
    const atCap: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-a',
      unit: 'kg',
      stackLoads: ['20', '21'],
    }
    const aboveCap: EquipmentInventory = { ...atCap, stackLoads: ['20', '21.001'] }

    expect(findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'stack-a'), atCap)?.quantity.entered.value)
      .toBe('21')
    expect(findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'stack-a'), aboveCap)).toBeNull()
  })

  it('does not return a bar-and-collar base that exceeds the five-percent search ceiling', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '20',
      collarsTotalWeight: '0',
      plates: [],
    }

    expect(findNextEquipmentLoad(currentLoad('10', 'kg', 'barbell_total', 'rack-a'), inventory)).toBeNull()
  })

  it('preserves the inventory unit, load basis, and exact equipment ID', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-lb',
      unit: 'lb',
      stackLoads: ['100', '102.5'],
    }

    expect(findNextEquipmentLoad(currentLoad('100', 'lb', 'machine_stack', 'stack-lb'), inventory)).toEqual({
      equipmentId: 'stack-lb',
      basis: 'machine_stack',
      quantity: createLoadQuantity({ value: '102.5', unit: 'lb' }),
    })
  })

  it.each([
    [{ value: '0.25', count: -1 }],
    [{ value: '0.25', count: 1.5 }],
    [{ value: '0.25', count: 1001 }],
    [{ value: '0', count: 2 }],
  ])('rejects invalid plate inventory %#', plate => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '20',
      collarsTotalWeight: '0',
      plates: [plate],
    }

    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'barbell_total', 'rack-a'), inventory)).toThrow()
  })

  it('rejects a different equipment ID, unit, or load basis instead of equating them', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-a',
      unit: 'kg',
      stackLoads: ['20', '21'],
    }

    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'stack-b'), inventory)).toThrow()
    expect(() => findNextEquipmentLoad(currentLoad('20', 'lb', 'machine_stack', 'stack-a'), inventory)).toThrow()
    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'dumbbell_per_hand', 'stack-a'), inventory)).toThrow()
  })

  it('requires a nonempty exact equipment ID', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: '',
      unit: 'kg',
      stackLoads: ['20', '21'],
    }

    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', ''), inventory))
      .toThrow('Equipment ID is required')
  })

  it('rejects more than 1,000 explicit load entries before scanning them', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-a',
      unit: 'kg',
      stackLoads: Array.from({ length: 1001 }, (_, index) => String(index)),
    }

    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'stack-a'), inventory))
      .toThrow('Equipment inventory exceeds 1000 entries')
  })

  it('rejects a forged current quantity whose canonical value does not match its preserved entry', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-a',
      unit: 'kg',
      stackLoads: ['20', '21'],
    }
    const forged: EquipmentLoad = {
      equipmentId: 'stack-a',
      basis: 'machine_stack',
      quantity: { entered: { value: '20', unit: 'kg' }, canonicalKg: '1' },
    }

    expect(() => findNextEquipmentLoad(forged, inventory)).toThrow()
  })

  it('fails closed when bounded barbell enumeration exceeds 50,000 states', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '0',
      collarsTotalWeight: '0',
      plates: Array.from({ length: 16 }, (_, index) => ({
        value: String(2 ** index),
        count: 2,
      })),
    }

    expect(() => findNextEquipmentLoad(currentLoad('100000', 'kg', 'barbell_total', 'rack-a'), inventory))
      .toThrow('Equipment load search exceeded 50000 states')
  })
})
