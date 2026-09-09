import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureImageFromDataUrl, fitCapturePhotoUpload, saveCaptureImages } from './saveCaptureImages'
import { emptySlot, type Captures } from './types'

function captures(): Captures {
  const frontImage = new Blob(['front pixels'], { type: 'image/jpeg' })
  const leftImage = new Blob(['left pixels'], { type: 'image/jpeg' })
  return {
    front: { ...emptySlot(), rawRepresentativeUrl: 'blob:raw-front', rawRepresentativeImage: frontImage, displayPreviewUrl: 'blob:corrected-front' },
    'side-left': { ...emptySlot(), rawRepresentativeUrl: 'blob:raw-left', rawRepresentativeImage: leftImage },
    'side-right': emptySlot(), back: emptySlot(),
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('saveCaptureImages', () => {
  it('uploads the retained acquisition blob without fetching its CSP-blocked object URL', async () => {
    const image = new Blob(['camera pixels'], { type: 'image/jpeg' })
    const captured = captures()
    captured.front = {
      ...captured.front,
      rawRepresentativeImage: image,
    } as typeof captured.front
    captured['side-left'] = emptySlot()
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('blob:')) throw new TypeError('Failed to fetch')
      const form = init!.body as FormData
      const uploaded = form.get('image') as Blob
      expect(uploaded.type).toBe(image.type)
      expect(await uploaded.text()).toBe(await image.text())
      return Response.json({ captureId: 'capture-1', slot: form.get('slot'), status: 'saved' })
    })
    vi.stubGlobal('fetch', request)

    await saveCaptureImages({
      assessmentId: 'assessment-1', captures: captured, signal: new AbortController().signal,
    })

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/assessments/assessment-1/capture-images',
    ])
  })

  it('decodes normalized acquisition data without a network read', async () => {
    const image = captureImageFromDataUrl('data:image/jpeg;base64,YWNxdWlzaXRpb24=')
    expect(image.type).toBe('image/jpeg')
    expect(await image.text()).toBe('acquisition')
  })

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
      const form = init!.body as FormData
      expect(form.get('image')).toBeInstanceOf(Blob)
      return Response.json({ captureId: 'capture-1', slot: form.get('slot'), status: 'already_saved' })
    })
    vi.stubGlobal('fetch', request)
    await saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal })
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/assessments/assessment-1/capture-images',
      '/api/assessments/assessment-1/capture-images',
    ])
  })

  it('reports a partial upload failure so navigation cannot silently discard unsaved photos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unavailable' }, { status: 503 })))
    await expect(saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal }))
      .rejects.toThrow('screening was saved')
  })

  it('rejects a receipt for the wrong view', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ slot: 'back', status: 'saved' })))
    await expect(saveCaptureImages({ assessmentId: 'assessment-1', captures: captures(), signal: new AbortController().signal }))
      .rejects.toThrow('photo was not')
  })
})
