import { describe, it, expect } from 'vitest'
import { SLOT_ORDER, REQUIRED_SLOTS, SLOT_LABEL, slotToDomain, emptySlot, isCaptured } from '../types'

describe('capture slot model', () => {
  it('has four slots in front, left, right, back order', () => {
    expect(SLOT_ORDER).toEqual(['front', 'side-left', 'side-right', 'back'])
  })

  it('requires front + both sides; back is optional', () => {
    expect(REQUIRED_SLOTS).toEqual(['front', 'side-left', 'side-right'])
    expect(REQUIRED_SLOTS).not.toContain('back')
  })

  it('maps each side slot to the side view carrying its laterality', () => {
    expect(slotToDomain('side-left')).toEqual({ view: 'side', profileSide: 'left' })
    expect(slotToDomain('side-right')).toEqual({ view: 'side', profileSide: 'right' })
  })

  it('maps front/back to their view with no profileSide', () => {
    expect(slotToDomain('front')).toEqual({ view: 'front' })
    expect(slotToDomain('back')).toEqual({ view: 'back' })
  })

  it('labels the side slots by laterality', () => {
    expect(SLOT_LABEL['side-left']).toBe('Left Side')
    expect(SLOT_LABEL['side-right']).toBe('Right Side')
  })

  it('emptySlot is idle with no capture', () => {
    const s = emptySlot()
    expect(s.rawRepresentativeUrl).toBeNull()
    expect(s.displayPreviewUrl).toBeNull()
    expect(s.slotStatus).toBe('idle')
    expect(s.captureId).toBeNull()
    expect(isCaptured(s)).toBe(false)
  })
})
