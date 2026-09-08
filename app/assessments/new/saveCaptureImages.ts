import { SLOT_ORDER, SLOT_LABEL, type Captures } from './types'

const MAX_PHOTO_BYTES = 3 * 1024 * 1024

export async function fitCapturePhotoUpload(image: Blob): Promise<Blob> {
  // Normal capture/upload acquisition already produces a bounded JPEG. Handle
  // older-browser raw-file fallbacks before hitting the hosting body limit.
  if (image.size <= MAX_PHOTO_BYTES) return image
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Use a photo smaller than 3 MB in this browser, then try again.')
  }
  const bitmap = await createImageBitmap(image)
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Photo preparation is unavailable in this browser.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!encoded || encoded.size > MAX_PHOTO_BYTES) throw new Error('Photo is too large to save. Use a smaller image and try again.')
    return encoded
  } finally {
    bitmap.close()
  }
}

/** Store acquisition pixels, never the rotated/corrected display preview. */
export async function saveCaptureImages({ assessmentId, captures, signal }: {
  assessmentId: string
  captures: Captures
  signal: AbortSignal
}): Promise<void> {
  for (const slot of SLOT_ORDER) {
    const url = captures[slot].rawRepresentativeUrl
    if (!url) continue
    if (!url.startsWith('blob:') && !url.startsWith('data:image/')) {
      throw new Error(`${SLOT_LABEL[slot]} photo is no longer available. Return to the photos and try again.`)
    }
    const pixels = await fetch(url, { signal })
    if (!pixels.ok) throw new Error(`${SLOT_LABEL[slot]} photo could not be read.`)
    let image = await pixels.blob()
    if (!['image/jpeg', 'image/png'].includes(image.type) || image.size === 0 || image.size > 20 * 1024 * 1024) {
      throw new Error(`${SLOT_LABEL[slot]} photo must be a JPEG or PNG smaller than 20 MB.`)
    }
    image = await fitCapturePhotoUpload(image)
    signal.throwIfAborted()
    const payload = new FormData()
    payload.set('slot', slot)
    payload.set('image', image, `${slot}.${image.type === 'image/png' ? 'png' : 'jpg'}`)
    const response = await fetch(`/api/assessments/${encodeURIComponent(assessmentId)}/capture-images`, {
      method: 'POST', body: payload, signal,
    })
    const receipt: unknown = await response.json().catch(() => null)
    if (!response.ok || !receipt || typeof receipt !== 'object'
      || !('slot' in receipt) || receipt.slot !== slot
      || !('status' in receipt) || !['saved', 'already_saved'].includes(String(receipt.status))) {
      throw new Error(`The screening was saved, but the ${SLOT_LABEL[slot]} photo was not. Retry to finish saving the capture set.`)
    }
  }
}
