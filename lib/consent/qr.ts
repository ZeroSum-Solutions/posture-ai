import QRCode from 'qrcode'

/** PNG data-URL QR code for a remote-consent link (rendered in the practitioner UI). */
export async function consentQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 256 })
}
