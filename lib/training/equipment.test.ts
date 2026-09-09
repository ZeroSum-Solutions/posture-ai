import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from './quantity'
import {
  enumerateEquipmentLoadsWithinBounds,
  findNextEquipmentLoad,
  type EquipmentInventory,
  type EquipmentLoad,
} from './equipment'

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

  it('progresses a single dumbbell implement without doubling its entered load', () => {
    const inventory: EquipmentInventory = {
      kind: 'dumbbell',
      equipmentId: 'db-set-a',
      unit: 'kg',
      perHandLoads: ['10', '10.5', '12.5'],
    }

    expect(findNextEquipmentLoad(currentLoad('10', 'kg', 'dumbbell_single_implement', 'db-set-a'), inventory)).toEqual({
      equipmentId: 'db-set-a',
      basis: 'dumbbell_single_implement',
      quantity: createLoadQuantity({ value: '10.5', unit: 'kg' }),
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

  it('enforces the 1000 kg equipment boundary on direct callers and generated totals', () => {
    const machine: EquipmentInventory = {
      kind: 'machine', equipmentId: 'stack-a', unit: 'kg', stackLoads: ['1000.001'],
    }
    expect(() => findNextEquipmentLoad(currentLoad('1000', 'kg', 'machine_stack', 'stack-a'), machine))
      .toThrow('Equipment load exceeds 1000 kg')

    const barbell: EquipmentInventory = {
      kind: 'barbell', equipmentId: 'rack-a', unit: 'kg', barWeight: '999', collarsTotalWeight: '0',
      plates: [{ value: '1', count: 2 }],
    }
    expect(findNextEquipmentLoad(currentLoad('999', 'kg', 'barbell_total', 'rack-a'), barbell)).toBeNull()
  })

  it('fails closed when bounded barbell enumeration exceeds 50,000 states', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell',
      equipmentId: 'rack-a',
      unit: 'kg',
      barWeight: '0',
      collarsTotalWeight: '0',
      plates: Array.from({ length: 16 }, (_, index) => ({
        value: String(2 ** index / 1000),
        count: 2,
      })),
    }

    expect(() => findNextEquipmentLoad(currentLoad('1000', 'kg', 'barbell_total', 'rack-a'), inventory))
      .toThrow('Equipment load search exceeded 50000 states')
  })

  it('rejects an unknown inventory kind with a stable validation error', () => {
    const inventory = {
      kind: 'cable',
      equipmentId: 'cable-a',
      unit: 'kg',
      stackLoads: ['20', '21'],
    } as unknown as EquipmentInventory

    expect(() => findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'cable-a'), inventory))
      .toThrow('Unsupported equipment inventory kind')
  })

  it.each([
    [{ kind: 'barbell', equipmentId: 'rack-a', unit: 'kg', barWeight: '20', collarsTotalWeight: '0' }, 'Barbell plates must be an array'],
    [{ kind: 'dumbbell', equipmentId: 'db-a', unit: 'kg' }, 'Dumbbell per-hand loads must be an array'],
    [{ kind: 'machine', equipmentId: 'stack-a', unit: 'kg' }, 'Machine stack loads must be an array'],
  ])('rejects malformed inventory arrays with a stable validation error %#', (inventory, message) => {
    expect(() => findNextEquipmentLoad(
      currentLoad('20', 'kg', inventory.kind === 'barbell' ? 'barbell_total' : inventory.kind === 'dumbbell' ? 'dumbbell_per_hand' : 'machine_stack', inventory.equipmentId),
      inventory as unknown as EquipmentInventory,
    )).toThrow(message)
  })

  it('freezes the returned equipment-load wrapper', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine',
      equipmentId: 'stack-a',
      unit: 'kg',
      stackLoads: ['20', '21'],
    }

    const result = findNextEquipmentLoad(currentLoad('20', 'kg', 'machine_stack', 'stack-a'), inventory)

    expect(result).not.toBeNull()
    expect(Object.isFrozen(result)).toBe(true)
  })
})

describe('enumerateEquipmentLoadsWithinBounds', () => {
  it('enumerates zero and exact added bodyweight loads without inventing a load increase', () => {
    const inventory: EquipmentInventory = {
      kind: 'bodyweight_external', equipmentId: 'dip-belt-a', unit: 'kg',
      externalLoads: ['0', '2.5', '5'],
    }

    expect(enumerateEquipmentLoadsWithinBounds(inventory, 'bodyweight_external', {
      minimumCanonicalKg: '0', maximumCanonicalKg: '3',
    }).map(load => load.quantity.entered.value)).toEqual(['0', '2.5'])
    expect(findNextEquipmentLoad(
      currentLoad('0', 'kg', 'bodyweight_external', 'dip-belt-a'), inventory,
    )).toBeNull()
  })

  it('enumerates exact nonnegative assistance settings without treating less assistance as generic load progression', () => {
    const inventory: EquipmentInventory = {
      kind: 'assistance_machine', equipmentId: 'assisted-pullup-a', unit: 'kg',
      assistanceLoads: ['10', '20', '30'],
    }

    expect(enumerateEquipmentLoadsWithinBounds(inventory, 'machine_assistance', {
      minimumCanonicalKg: '15', maximumCanonicalKg: '30',
    }).map(load => load.quantity.entered.value)).toEqual(['20', '30'])
    expect(findNextEquipmentLoad(
      currentLoad('20', 'kg', 'machine_assistance', 'assisted-pullup-a'), inventory,
    )).toBeNull()
    expect(() => enumerateEquipmentLoadsWithinBounds(inventory, 'machine_stack', {
      minimumCanonicalKg: '0', maximumCanonicalKg: '30',
    })).toThrow('Load basis does not match inventory')
  })

  it('returns exact single-implement dumbbell denominations without pair doubling', () => {
    const inventory: EquipmentInventory = {
      kind: 'dumbbell', equipmentId: 'db-a', unit: 'kg', perHandLoads: ['20', '10', '12.5', '10.000'],
    }

    const loads = enumerateEquipmentLoadsWithinBounds(inventory, 'dumbbell_single_implement', {
      minimumCanonicalKg: '10',
      maximumCanonicalKg: '15',
    })

    expect(loads.map(load => load.quantity.entered.value)).toEqual(['10', '12.5'])
    expect(loads.every(load => load.basis === 'dumbbell_single_implement')).toBe(true)
    expect(loads.map(load => load.quantity.canonicalKg)).not.toContain('20')
    expect(Object.isFrozen(loads)).toBe(true)
  })

  it('enumerates bar, collars, symmetric microplate pairs within exact bounds', () => {
    const inventory: EquipmentInventory = {
      kind: 'barbell', equipmentId: 'rack-a', unit: 'kg', barWeight: '20', collarsTotalWeight: '0.5',
      plates: [{ value: '20', count: 2 }, { value: '1', count: 2 }, { value: '0.25', count: 2 }],
    }

    expect(enumerateEquipmentLoadsWithinBounds(inventory, 'barbell_total', {
      minimumCanonicalKg: '60',
      maximumCanonicalKg: '63',
    }).map(load => load.quantity.entered.value)).toEqual(['60.5', '61', '62.5', '63'])
  })

  it('applies mixed-unit physical bounds and rejects inverted bounds', () => {
    const inventory: EquipmentInventory = {
      kind: 'machine', equipmentId: 'stack-lb', unit: 'lb', stackLoads: ['100', '101', '102'],
    }
    expect(enumerateEquipmentLoadsWithinBounds(inventory, 'machine_stack', {
      minimumCanonicalKg: '45.359237',
      maximumCanonicalKg: '46',
    }).map(load => load.quantity.entered.value)).toEqual(['100', '101'])
    expect(() => enumerateEquipmentLoadsWithinBounds(inventory, 'machine_stack', {
      minimumCanonicalKg: '46',
      maximumCanonicalKg: '45',
    })).toThrow('Equipment load bounds are inverted')
  })

  it('keeps bases tied to the matching equipment convention', () => {
    const dumbbells: EquipmentInventory = { kind: 'dumbbell', equipmentId: 'db-a', unit: 'kg', perHandLoads: ['10'] }
    const machine: EquipmentInventory = { kind: 'machine', equipmentId: 'stack-a', unit: 'kg', stackLoads: ['10'] }
    expect(() => enumerateEquipmentLoadsWithinBounds(dumbbells, 'machine_stack', {
      minimumCanonicalKg: '0', maximumCanonicalKg: '100',
    })).toThrow('Load basis does not match inventory')
    expect(() => enumerateEquipmentLoadsWithinBounds(machine, 'dumbbell_single_implement', {
      minimumCanonicalKg: '0', maximumCanonicalKg: '100',
    })).toThrow('Load basis does not match inventory')
  })

  it('rejects an enumeration maximum above the V1 parser boundary', () => {
    const inventory: EquipmentInventory = { kind: 'machine', equipmentId: 'stack-a', unit: 'kg', stackLoads: ['10'] }
    expect(() => enumerateEquipmentLoadsWithinBounds(inventory, 'machine_stack', {
      minimumCanonicalKg: '0', maximumCanonicalKg: '1000.001',
    })).toThrow('Equipment load maximum exceeds 1000 kg')
  })
})
