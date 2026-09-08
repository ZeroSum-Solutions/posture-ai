export type LoadUnit = 'kg' | 'lb'

export interface EnteredLoadQuantity {
  readonly value: string
  readonly unit: LoadUnit
}

export interface ExactLoadQuantity {
  readonly entered: EnteredLoadQuantity
  readonly canonicalKg: string
}

export interface PairedLoadTotal {
  readonly totalKg: string
  readonly source: ExactLoadQuantity
}

export interface ExactRatio {
  readonly numerator: number
  readonly denominator: number
}

export type LoadIncreaseRatioComparison =
  | 'calibration_required'
  | 'not_increase'
  | 'within_limit'
  | 'exceeds_limit'

interface ScaledInteger {
  digits: string
  scale: number
}

const ENTERED_DECIMAL = /^\d+(?:\.\d{1,3})?$/
const EXACT_DECIMAL = /^\d+(?:\.\d+)?$/
const LB_TO_KG: ScaledInteger = { digits: '45359237', scale: 8 }
const MAX_ENTERED_LENGTH = 16
const MAX_INTEGER_DIGITS = 12
const MAX_RATIO_COMPONENT = 1_000_000

function parseDecimal(value: string, pattern: RegExp): ScaledInteger {
  if (!pattern.test(value)) throw new Error('Invalid exact decimal')

  const [whole, fraction = ''] = value.split('.')
  return {
    digits: `${whole}${fraction}`.replace(/^0+(?=\d)/, ''),
    scale: fraction.length,
  }
}

function formatDecimal({ digits, scale }: ScaledInteger): string {
  if (/^0+$/.test(digits)) return '0'

  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    scale -= 1
  }

  if (scale === 0) return digits
  if (digits.length <= scale) return `0.${'0'.repeat(scale - digits.length)}${digits}`
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

function multiplyDigits(left: string, right: string): string {
  const result = Array.from({ length: left.length + right.length }, () => 0)

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    let carry = 0
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const resultIndex = leftIndex + rightIndex + 1
      const product = Number(left[leftIndex]) * Number(right[rightIndex]) + result[resultIndex] + carry
      result[resultIndex] = product % 10
      carry = Math.floor(product / 10)
    }
    result[leftIndex] += carry
  }

  return result.join('').replace(/^0+(?=\d)/, '')
}

function multiply(left: ScaledInteger, right: ScaledInteger): ScaledInteger {
  return {
    digits: multiplyDigits(left.digits, right.digits),
    scale: left.scale + right.scale,
  }
}

function compareScaledIntegers(left: ScaledInteger, right: ScaledInteger): number {
  const scale = Math.max(left.scale, right.scale)
  const leftDigits = left.digits.padEnd(left.digits.length + scale - left.scale, '0').replace(/^0+(?=\d)/, '')
  const rightDigits = right.digits.padEnd(right.digits.length + scale - right.scale, '0').replace(/^0+(?=\d)/, '')
  if (leftDigits.length !== rightDigits.length) return leftDigits.length < rightDigits.length ? -1 : 1
  if (leftDigits === rightDigits) return 0
  return leftDigits < rightDigits ? -1 : 1
}

export function createLoadQuantity(input: EnteredLoadQuantity): ExactLoadQuantity {
  if (input.unit !== 'kg' && input.unit !== 'lb') throw new Error('Load unit must be kg or lb')
  if (typeof input.value !== 'string') throw new Error('Load value must be a string')
  if (input.value.length > MAX_ENTERED_LENGTH) throw new Error('Load value exceeds 16 characters')
  if (!ENTERED_DECIMAL.test(input.value)) {
    throw new Error('Load value must be an unsigned decimal with at most three fractional digits')
  }
  if (input.value.split('.')[0].length > MAX_INTEGER_DIGITS) {
    throw new Error('Load value has more than 12 integer digits')
  }

  const entered = parseDecimal(input.value, ENTERED_DECIMAL)
  const canonicalKg = input.unit === 'kg'
    ? formatDecimal(entered)
    : formatDecimal(multiply(entered, LB_TO_KG))

  return Object.freeze({
    entered: Object.freeze({ value: input.value, unit: input.unit }),
    canonicalKg,
  })
}

export function derivePairedTotal(quantity: ExactLoadQuantity): PairedLoadTotal {
  const source = createLoadQuantity(quantity.entered)
  const canonicalKg = parseDecimal(source.canonicalKg, EXACT_DECIMAL)
  return Object.freeze({
    totalKg: formatDecimal(multiply(canonicalKg, { digits: '2', scale: 0 })),
    source,
  })
}

export function compareLoadIncreaseToRatio(
  prior: ExactLoadQuantity | null,
  actual: ExactLoadQuantity,
  ratio: ExactRatio,
): LoadIncreaseRatioComparison {
  if (!Number.isInteger(ratio.numerator)
    || ratio.numerator < 0
    || ratio.numerator > MAX_RATIO_COMPONENT
    || !Number.isInteger(ratio.denominator)
    || ratio.denominator < 1
    || ratio.denominator > MAX_RATIO_COMPONENT) {
    throw new Error('Invalid exact ratio')
  }

  const actualSource = createLoadQuantity(actual.entered)
  if (prior === null) return 'calibration_required'
  const priorSource = createLoadQuantity(prior.entered)
  const actualKg = parseDecimal(actualSource.canonicalKg, EXACT_DECIMAL)
  const priorKg = parseDecimal(priorSource.canonicalKg, EXACT_DECIMAL)
  if (compareScaledIntegers(priorKg, { digits: '0', scale: 0 }) === 0) return 'calibration_required'
  if (compareScaledIntegers(actualKg, priorKg) <= 0) return 'not_increase'

  const weightedActual = multiply(actualKg, { digits: String(ratio.denominator), scale: 0 })
  const weightedLimit = multiply(priorKg, {
    digits: String(ratio.denominator + ratio.numerator),
    scale: 0,
  })
  return compareScaledIntegers(weightedActual, weightedLimit) > 0 ? 'exceeds_limit' : 'within_limit'
}

export function isEnteredLoadAtMostCanonicalKg(
  entered: EnteredLoadQuantity,
  maximumCanonicalKg: string,
): boolean {
  if (typeof maximumCanonicalKg !== 'string' || !EXACT_DECIMAL.test(maximumCanonicalKg)) {
    throw new Error('Invalid canonical load limit')
  }
  const maximum = parseDecimal(maximumCanonicalKg, EXACT_DECIMAL)
  const load = createLoadQuantity(entered)
  return compareScaledIntegers(parseDecimal(load.canonicalKg, EXACT_DECIMAL), maximum) <= 0
}
