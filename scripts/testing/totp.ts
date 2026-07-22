import { createHmac } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '')
  let bits = ''

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) throw new Error('Invalid base32 TOTP secret')
    bits += index.toString(2).padStart(5, '0')
  }

  const bytes: number[] = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}

/** Generate a standards-compliant TOTP for local Auth test fixtures. */
export function totpCode(
  secret: string,
  nowMs = Date.now(),
  options: { stepSeconds?: number; digits?: number } = {},
): string {
  const stepSeconds = options.stepSeconds ?? 30
  const digits = options.digits ?? 6
  const counter = Math.floor(nowMs / 1000 / stepSeconds)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)

  return String(binary % (10 ** digits)).padStart(digits, '0')
}
