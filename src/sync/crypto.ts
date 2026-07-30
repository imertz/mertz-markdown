import { gunzipSync, gzipSync } from 'fflate'
import type { SyncObjectKind } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const FORMAT_VERSION = 1
const NONCE_BYTES = 12

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

export async function decryptJson<T>(
  framed: Uint8Array,
  masterKey: ArrayBuffer | Uint8Array<ArrayBuffer>,
  vaultId: string,
  kind: SyncObjectKind,
  objectId: string,
): Promise<T> {
  const compressed = await decryptBytes(framed, masterKey, vaultId, kind, objectId)
  return JSON.parse(decoder.decode(gunzipSync(compressed))) as T
}

export async function sha256Base64Url(value: Uint8Array): Promise<string> {
  return toBase64Url(await crypto.subtle.digest('SHA-256', ownedBytes(value)))
}
