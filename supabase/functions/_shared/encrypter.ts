/**
 * PIN gate crypto shared by the studio (seal) and the verify-pin function (open).
 *
 * The 4-digit PIN is never stored. PBKDF2-SHA-256 stretches it for 50,000
 * iterations into an AES-256-GCM key (key stretching; sometimes called a key
 * extender). The file list is encrypted with that key. A PIN is correct only
 * when decryption succeeds.
 */

export const PBKDF2_ITERATIONS = 50_000

export type SealedShare = {
  salt: string
  iv: string
  ciphertext: string
}

export type ShareFile = {
  name: string
  url: string
}

export type SharePayload = {
  v: 1
  title: string
  files: ShareFile[]
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + step))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

export function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

/** Uniform random PIN from 0000 through 9999. A new link always gets a new code. */
export function randomPin(): string {
  const span = 10_000
  const limit = Math.floor(0x1_0000_0000 / span) * span
  const buf = new Uint32Array(1)
  let value = 0
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return String(value % span).padStart(4, '0')
}

async function deriveKey(pin: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

function isCaseSignedUrl(value: string): boolean {
  if (!value || value.length > 4000) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.pathname.includes('/storage/v1/object/sign/cases/') && !url.pathname.includes('..')
  } catch {
    return false
  }
}

function isPayload(value: unknown): value is SharePayload {
  if (!value || typeof value !== 'object') return false
  const row = value as SharePayload
  if (row.v !== 1 || typeof row.title !== 'string' || row.title.length > 120) return false
  if (!Array.isArray(row.files) || row.files.length < 1 || row.files.length > 40) return false
  return row.files.every((file) => {
    if (!file || typeof file.name !== 'string' || typeof file.url !== 'string') return false
    if (!file.name || file.name.length > 120) return false
    return isCaseSignedUrl(file.url)
  })
}

export async function sealShare(pin: string, payload: SharePayload): Promise<SealedShare> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits')
  if (!isPayload(payload)) throw new Error('Share payload is not valid')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(pin, salt, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      textEncoder.encode(JSON.stringify(payload)),
    ),
  )
  return {
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext),
  }
}

/** Returns the file list when the PIN unwraps the payload, otherwise null. */
export async function openShare(pin: string, sealed: SealedShare): Promise<SharePayload | null> {
  if (!/^\d{4}$/.test(pin)) return null
  try {
    const salt = b64ToBytes(sealed.salt)
    const iv = b64ToBytes(sealed.iv)
    const ciphertext = b64ToBytes(sealed.ciphertext)
    if (salt.byteLength < 16 || iv.byteLength !== 12 || ciphertext.byteLength < 16) return null
    const key = await deriveKey(pin, salt, ['decrypt'])
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(ciphertext),
    )
    const parsed: unknown = JSON.parse(textDecoder.decode(plain))
    return isPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}
