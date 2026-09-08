import { createLoadQuantity, type ExactLoadQuantity, type LoadUnit } from './quantity'

export type EquipmentLoadBasis = 'barbell_total' | 'dumbbell_per_hand' | 'machine_stack'

export interface EquipmentLoad {
  readonly equipmentId: string
  readonly basis: EquipmentLoadBasis
  readonly quantity: ExactLoadQuantity
}

interface InventoryBase {
  readonly equipmentId: string
  readonly unit: LoadUnit
}

export interface BarbellInventory extends InventoryBase {
  readonly kind: 'barbell'
  readonly barWeight: string
  readonly collarsTotalWeight: string
  readonly plates: readonly {
    readonly value: string
    readonly count: number
  }[]
}

export interface DumbbellInventory extends InventoryBase {
  readonly kind: 'dumbbell'
  readonly perHandLoads: readonly string[]
}

export interface MachineInventory extends InventoryBase {
  readonly kind: 'machine'
  readonly stackLoads: readonly string[]
}

export type EquipmentInventory = BarbellInventory | DumbbellInventory | MachineInventory

const MAX_INVENTORY_ENTRIES = 1_000
const MAX_PLATES_PER_DENOMINATION = 1_000
const MAX_BAR_LOAD_STATES = 50_000

function normalizeInteger(value: string): string {
  return value.replace(/^0+(?=\d)/, '')
}

function compareIntegers(left: string, right: string): number {
  const normalizedLeft = normalizeInteger(left)
  const normalizedRight = normalizeInteger(right)
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1
  }
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

function addIntegers(left: string, right: string): string {
  let leftIndex = left.length - 1
  let rightIndex = right.length - 1
  let carry = 0
  let result = ''

  while (leftIndex >= 0 || rightIndex >= 0 || carry > 0) {
    const sum = Number(left[leftIndex] ?? 0) + Number(right[rightIndex] ?? 0) + carry
    result = `${sum % 10}${result}`
    carry = Math.floor(sum / 10)
    leftIndex -= 1
    rightIndex -= 1
  }

  return normalizeInteger(result)
}

function multiplyBySmallInteger(value: string, factor: number): string {
  let carry = 0
  let result = ''

  for (let index = value.length - 1; index >= 0; index -= 1) {
    const product = Number(value[index]) * factor + carry
    result = `${product % 10}${result}`
    carry = Math.floor(product / 10)
  }

  while (carry > 0) {
    result = `${carry % 10}${result}`
    carry = Math.floor(carry / 10)
  }

  return normalizeInteger(result)
}

function toThousandths(value: string, unit: LoadUnit): string {
  createLoadQuantity({ value, unit })
  const [whole, fraction = ''] = value.split('.')
  return normalizeInteger(`${whole}${fraction.padEnd(3, '0')}`)
}

function fromThousandths(value: string): string {
  const padded = normalizeInteger(value).padStart(4, '0')
  const whole = padded.slice(0, -3)
  const fraction = padded.slice(-3).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

function expectedBasis(inventory: EquipmentInventory): EquipmentLoadBasis {
  if (inventory.kind === 'barbell') return 'barbell_total'
  if (inventory.kind === 'dumbbell') return 'dumbbell_per_hand'
  return 'machine_stack'
}

function assertCurrentMatches(current: EquipmentLoad, inventory: EquipmentInventory): void {
  const reconstructed = createLoadQuantity(current.quantity.entered)
  if (reconstructed.canonicalKg !== current.quantity.canonicalKg) {
    throw new Error('Current load quantity is not canonical')
  }
  if (typeof inventory.equipmentId !== 'string' || inventory.equipmentId.trim().length === 0) {
    throw new Error('Equipment ID is required')
  }
  if (current.equipmentId !== inventory.equipmentId) throw new Error('Equipment ID does not match inventory')
  if (current.quantity.entered.unit !== inventory.unit) throw new Error('Load unit does not match inventory')
  if (current.basis !== expectedBasis(inventory)) throw new Error('Load basis does not match inventory')
}

function withinFivePercent(candidate: string, current: string): boolean {
  return compareIntegers(multiplyBySmallInteger(candidate, 100), multiplyBySmallInteger(current, 105)) <= 0
}

function findNextExplicitLoad(
  current: string,
  values: readonly string[],
  unit: LoadUnit,
): string | null {
  if (values.length > MAX_INVENTORY_ENTRIES) throw new Error('Equipment inventory exceeds 1000 entries')

  const candidates = new Set(values.map(value => toThousandths(value, unit)))
  let best: string | null = null
  for (const candidate of candidates) {
    if (compareIntegers(candidate, current) <= 0 || !withinFivePercent(candidate, current)) continue
    if (best === null || compareIntegers(candidate, best) < 0) best = candidate
  }
  return best
}

function barbellLoadsWithinCap(
  inventory: BarbellInventory,
  current: string,
): Set<string> {
  if (inventory.plates.length > MAX_INVENTORY_ENTRIES) {
    throw new Error('Equipment inventory exceeds 1000 entries')
  }

  const bar = toThousandths(inventory.barWeight, inventory.unit)
  const collars = toThousandths(inventory.collarsTotalWeight, inventory.unit)
  const base = addIntegers(bar, collars)
  const denominations = new Map<string, number>()

  for (const plate of inventory.plates) {
    if (!Number.isInteger(plate.count) || plate.count < 0 || plate.count > MAX_PLATES_PER_DENOMINATION) {
      throw new Error('Plate count must be an integer from 0 to 1000')
    }
    const value = toThousandths(plate.value, inventory.unit)
    if (compareIntegers(value, '0') === 0) throw new Error('Plate value must be greater than zero')
    const combinedCount = (denominations.get(value) ?? 0) + plate.count
    if (combinedCount > MAX_PLATES_PER_DENOMINATION) {
      throw new Error('Combined plate count exceeds 1000')
    }
    denominations.set(value, combinedCount)
  }

  let additions = new Set(['0'])
  for (const [plateValue, count] of denominations) {
    const pairValue = multiplyBySmallInteger(plateValue, 2)
    const pairCount = Math.floor(count / 2)
    const nextAdditions = new Set(additions)

    for (const existing of additions) {
      let added = existing
      for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        added = addIntegers(added, pairValue)
        const total = addIntegers(base, added)
        if (!withinFivePercent(total, current)) break
        nextAdditions.add(added)
        if (nextAdditions.size > MAX_BAR_LOAD_STATES) {
          throw new Error('Equipment load search exceeded 50000 states')
        }
      }
    }
    additions = nextAdditions
  }

  return new Set(Array.from(additions, addition => addIntegers(base, addition)))
}

export function findNextEquipmentLoad(
  current: EquipmentLoad,
  inventory: EquipmentInventory,
): EquipmentLoad | null {
  assertCurrentMatches(current, inventory)
  const currentValue = toThousandths(current.quantity.entered.value, inventory.unit)

  let nextValue: string | null = null
  if (inventory.kind === 'barbell') {
    for (const candidate of barbellLoadsWithinCap(inventory, currentValue)) {
      if (compareIntegers(candidate, currentValue) <= 0 || !withinFivePercent(candidate, currentValue)) continue
      if (nextValue === null || compareIntegers(candidate, nextValue) < 0) nextValue = candidate
    }
  } else {
    const values = inventory.kind === 'dumbbell' ? inventory.perHandLoads : inventory.stackLoads
    nextValue = findNextExplicitLoad(currentValue, values, inventory.unit)
  }

  if (nextValue === null) return null
  return {
    equipmentId: inventory.equipmentId,
    basis: expectedBasis(inventory),
    quantity: createLoadQuantity({ value: fromThousandths(nextValue), unit: inventory.unit }),
  }
}
