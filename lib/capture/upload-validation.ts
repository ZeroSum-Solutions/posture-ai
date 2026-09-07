const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

export async function validateCaptureUpload(file: File): Promise<void> {
  const type = file.type.toLowerCase()
  if (type !== 'image/jpeg' && type !== 'image/png') {
    throw new Error('Choose a JPEG or PNG image.')
  }
  if (file.size === 0) throw new Error('The selected image is empty.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Choose an image smaller than 20 MB.')

  const signature = new Uint8Array(await readBytes(file.slice(0, 8)))
  const isJpeg = signature.length >= 3
    && signature[0] === 0xff
    && signature[1] === 0xd8
    && signature[2] === 0xff
  const isPng = signature.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => signature[index] === byte)
  if ((type === 'image/jpeg' && !isJpeg) || (type === 'image/png' && !isPng)) {
    throw new Error('The file contents do not match the selected image format.')
  }
}
