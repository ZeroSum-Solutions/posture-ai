// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { syncPixelQualityTestHooks } from './pixel-quality-test-hooks'
import { samplePixelsFromSource } from './pixel-sample'
import { assessPixelQuality } from './pixel-quality'

describe('syncPixelQualityTestHooks', () => {
  afterEach(() => {
    delete window.__pixelQualityHooks
  })

  it('installs window.__pixelQualityHooks with the production functions when testMode is true', () => {
    syncPixelQualityTestHooks(true)
    expect(window.__pixelQualityHooks).toBeDefined()
    expect(window.__pixelQualityHooks!.samplePixelsFromSource).toBe(samplePixelsFromSource)
    expect(window.__pixelQualityHooks!.assessPixelQuality).toBe(assessPixelQuality)
  })

  it('leaves window.__pixelQualityHooks absent (not just falsy) when testMode is false', () => {
    syncPixelQualityTestHooks(false)
    expect('__pixelQualityHooks' in window).toBe(false)
    expect(window.__pixelQualityHooks).toBeUndefined()
  })

  it('removes a previously-installed hook object when the gate flips off', () => {
    syncPixelQualityTestHooks(true)
    expect('__pixelQualityHooks' in window).toBe(true)
    syncPixelQualityTestHooks(false)
    expect('__pixelQualityHooks' in window).toBe(false)
  })
})
