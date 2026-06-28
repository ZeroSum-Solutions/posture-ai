// Unit conversions. The database stores metric (height_cm, weight_kg) as the
// canonical unit; the UI lets practitioners enter and read US units (in/lb).
export const CM_PER_INCH = 2.54
export const KG_PER_POUND = 0.45359237

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH
}
export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH
}
export function poundsToKg(pounds: number): number {
  return pounds * KG_PER_POUND
}
export function kgToPounds(kg: number): number {
  return kg / KG_PER_POUND
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
