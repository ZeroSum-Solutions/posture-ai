import { describe, expect, it } from 'vitest'
import {
  TIER_B_CAPTURE_SLOTS,
  TIER_B_REPEAT_IDS,
  TIER_B_VIEWS,
} from './tierb-contract'

describe('Tier B frozen capture contract', () => {
  it('binds every public slot to the exact engine view and profile side', () => {
    expect(TIER_B_CAPTURE_SLOTS).toEqual([
      { key: 'front', label: 'Front', engineView: 'front', profileSide: null },
      { key: 'side_left', label: 'Side left', engineView: 'side', profileSide: 'left' },
      { key: 'back', label: 'Back', engineView: 'back', profileSide: null },
      { key: 'side_right', label: 'Side right', engineView: 'side', profileSide: 'right' },
    ])
    expect(TIER_B_CAPTURE_SLOTS.map((slot) => slot.key)).toEqual(TIER_B_VIEWS)
    expect(TIER_B_REPEAT_IDS).toEqual([1, 2, 3])
  })
})
