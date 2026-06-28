import { describe, it, expect } from 'vitest'
import { inchesToCm, cmToInches, poundsToKg, kgToPounds, round1 } from './units'

describe('unit conversions', () => {
  it('converts inches to centimeters (1 in = 2.54 cm)', () => {
    expect(inchesToCm(1)).toBeCloseTo(2.54, 10)
    expect(inchesToCm(69)).toBeCloseTo(175.26, 10)
  })

  it('converts centimeters to inches', () => {
    expect(cmToInches(2.54)).toBeCloseTo(1, 10)
    expect(cmToInches(175.26)).toBeCloseTo(69, 10)
  })

  it('converts pounds to kilograms (1 lb = 0.45359237 kg)', () => {
    expect(poundsToKg(1)).toBeCloseTo(0.45359237, 10)
    expect(poundsToKg(154)).toBeCloseTo(69.85322, 4)
  })

  it('converts kilograms to pounds', () => {
    expect(kgToPounds(0.45359237)).toBeCloseTo(1, 10)
    expect(kgToPounds(70)).toBeCloseTo(154.3236, 3)
  })

  it('round-trips inches -> cm -> inches', () => {
    expect(cmToInches(inchesToCm(70))).toBeCloseTo(70, 10)
  })

  it('round-trips pounds -> kg -> pounds', () => {
    expect(kgToPounds(poundsToKg(180))).toBeCloseTo(180, 10)
  })

  it('round1 rounds to one decimal place', () => {
    expect(round1(175.26)).toBe(175.3)
    expect(round1(69.049)).toBe(69)
    expect(round1(154.36)).toBe(154.4)
  })
})
