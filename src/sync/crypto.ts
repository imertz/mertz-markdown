import { Gunzip, gzipSync } from 'fflate'
import type { SyncObjectKind } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const FORMAT_VERSION = 1
const NONCE_BYTES = 12
/**
 * Cap on a decrypted document package. The server bounds the ciphertext but
 * not the gzip ratio, so without this an attacker who can write to a vault
 * could ship a tiny object that inflates to gigabytes on every other device.
 */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024

export function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)))
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return ownedBytes(Uint8Array.from(binary, character => character.charCodeAt(0)))
}

async function deriveObjectKey(
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind | 'pairing',
  objectId: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`mertz-markdown/v1/${vaultId}`),
      info: encoder.encode(`${kind}/${objectId}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function aad(
  vaultId: string,
  kind: SyncObjectKind | 'pairing',
  objectId: string,
): Uint8Array<ArrayBuffer> {
  return ownedBytes(
    encoder.encode(`mertz-markdown|1|${vaultId}|${kind}|${objectId}`),
  )
}

export async function encryptBytes(
  bytes: Uint8Array,
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind | 'pairing',
  objectId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await deriveObjectKey(masterKey, vaultId, kind, objectId)
  const nonce = randomBytes(NONCE_BYTES)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(vaultId, kind, objectId) },
    key,
    ownedBytes(bytes),
  )
  const framed = new Uint8Array(1 + nonce.length + ciphertext.byteLength)
  framed[0] = FORMAT_VERSION
  framed.set(nonce, 1)
  framed.set(new Uint8Array(ciphertext), 1 + nonce.length)
  return framed
}

export async function decryptBytes(
  framed: Uint8Array,
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind | 'pairing',
  objectId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (framed[0] !== FORMAT_VERSION || framed.length <= 1 + NONCE_BYTES) {
    throw new Error('Unsupported or incomplete encrypted object')
  }
  const key = await deriveObjectKey(masterKey, vaultId, kind, objectId)
  const nonce = framed.slice(1, 1 + NONCE_BYTES)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad(vaultId, kind, objectId) },
    key,
    ownedBytes(framed.slice(1 + NONCE_BYTES)),
  )
  return new Uint8Array(plaintext)
}

export async function encryptJson(
  value: unknown,
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind,
  objectId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = gzipSync(encoder.encode(JSON.stringify(value)), { level: 6 })
  return encryptBytes(ownedBytes(compressed), masterKey, vaultId, kind, objectId)
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function inflateWithLimit(
  compressed: Uint8Array,
  limit = MAX_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  // Streaming decompression lets us bail as soon as the cap is crossed rather
  // than holding the whole bomb in memory first. The slice produces an
  // ArrayBuffer-backed view, which Blob's type accepts.
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([compressed.slice()]).stream().pipeThrough(
      new DecompressionStream('gzip'),
    )
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return joinChunks(chunks, total)
        total += value.byteLength
        if (total > limit) {
          await reader.cancel().catch(() => undefined)
          throw new Error('The encrypted object expands beyond the safe limit')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  // Older Safari has no DecompressionStream. fflate's streaming decoder keeps
  // this path bounded too; feeding small compressed chunks prevents a fallback
  // from allocating the complete inflated payload before the cap is checked.
  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false
    const gunzip = new Gunzip((chunk, final) => {
      if (settled) return
      total += chunk.byteLength
      if (total > limit) {
        settled = true
        reject(new Error('The encrypted object expands beyond the safe limit'))
        return
      }
      if (chunk.byteLength) chunks.push(chunk)
      if (final) {
        settled = true
        resolve(joinChunks(chunks, total))
      }
    })

    try {
      // Limit the largest temporary expansion produced by one synchronous
      // decoder call, independently of the browser's source chunking.
      const chunkSize = 16 * 1024
      for (let offset = 0; offset < compressed.byteLength && !settled; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, compressed.byteLength)
        gunzip.push(compressed.subarray(offset, end), end === compressed.byteLength)
      }
      if (compressed.byteLength === 0) gunzip.push(compressed, true)
    } catch (error) {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
  })
}

export async function decryptJson<T>(
  framed: Uint8Array,
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind,
  objectId: string,
): Promise<T> {
  const compressed = await decryptBytes(framed, masterKey, vaultId, kind, objectId)
  const inflated = await inflateWithLimit(compressed)
  return JSON.parse(decoder.decode(inflated)) as T
}

export async function sha256Base64Url(value: Uint8Array): Promise<string> {
  return toBase64Url(await crypto.subtle.digest('SHA-256', ownedBytes(value)))
}
