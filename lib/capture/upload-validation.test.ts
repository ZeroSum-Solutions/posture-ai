import { describe, expect, it } from 'vitest'
import { validateCaptureUpload } from './upload-validation'

describe('validateCaptureUpload', () => {
  it('accepts matching JPEG and PNG signatures', async () => {
    await expect(validateCaptureUpload(new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    ], 'capture.jpg', { type: 'image/jpeg' }))).resolves.toBeUndefined()
    await expect(validateCaptureUpload(new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], 'capture.png', { type: 'image/png' }))).resolves.toBeUndefined()
  })

  it('rejects MIME spoofing before decode or model work starts', async () => {
    await expect(validateCaptureUpload(
      new File(['not an image'], 'capture.jpg', { type: 'image/jpeg' }),
    )).rejects.toThrow('file contents do not match')
  })
})
