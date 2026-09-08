import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitCapturePhotoUpload, saveCaptureImages } from './saveCaptureImages'
import { emptySlot, type Captures } from './types'

function captures(): Captures {
  return {
    front: { ...emptySlot(), rawRepresentativeUrl: 'blob:raw-front', displayPreviewUrl: 'blob:corrected-front' },
    'side-left': { ...emptySlot(), rawRepresentativeUrl: 'blob:raw-left' },
    'side-right': emptySlot(), back: emptySlot(),
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('saveCaptureImages', () => {
  it('fits a large phone image below the production payload limit and releases decoded pixels', async () => {
    const bitmap = { width: 4000, height: 6000, close: vi.fn() }
    const drawImage = vi.fn()
    const encoded = new Blob(['small JPEG'], { type: 'image/jpeg' })
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (done: (blob: Blob) => void) => done(encoded) }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('document', { createElement: () => canvas })
    expect(await fitCapturePhotoUpload(new Blob([new Uint8Array(4 * 1024 * 1024)]))).toBe(encoded)
    expect(canvas.height).toBe(2048)
    expect(canvas.width).toBe(1365)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('does not send an image when re-encoding still exceeds the upload budget', async () => {
    const bitmap = { width: 4000, height: 6000, close: vi.fn() }
    const oversized = new Blob([new Uint8Array(4 * 1024 * 1024)])
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (done: (blob: Blob) => void) => done(oversized) }) })
    await expect(fitCapturePhotoUpload(oversized)).rejects.toThrow('too large')
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('saves one acquisition image per matching slot and accepts an exact retry receipt', async () => {
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('blob:')) return new Response(new Blob(['pixels'], { type: 'image/jpeg' }))
      const form = init!.body as FormData
      expect(form.get('image')).toBeInstanceOf(Blob)
      return Response.json({ captureId: 'capture-1', slot: form.get('slot'), status: 'already_saved' })
    })
    vi.stubGlobal('fetch', request)
    await saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal })
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'blob:raw-front', '/api/assessments/assessment-1/capture-images',
      'blob:raw-left', '/api/assessments/assessment-1/capture-images',
    ])
  })

  it('reports a partial upload failure so navigation cannot silently discard unsaved photos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('blob:')
      ? new Response(new Blob(['pixels'], { type: 'image/jpeg' }))
      : Response.json({ error: 'unavailable' }, { status: 503 })))
    await expect(saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal }))
      .rejects.toThrow('screening was saved')
  })

  it('rejects a receipt for the wrong view', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.startsWith('blob:')
      ? new Response(new Blob(['pixels'], { type: 'image/jpeg' }))
      : Response.json({ slot: 'back', status: 'saved' })))
    await expect(saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal }))
      .rejects.toThrow('photo was not')
  })
})
