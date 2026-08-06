import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  inflateWithLimit,
  randomBytes,
} from '../sync/crypto'

describe('vault encryption', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('round-trips compressed JSON and uses a fresh nonce every time', async () => {
    const key = randomBytes(32)
    const value = { title: 'Private', markdown: '# Secret\n' }
    const first = await encryptJson(value, key, 'vault-abc', 'document', 'doc-1')
    const second = await encryptJson(value, key, 'vault-abc', 'document', 'doc-1')

    expect(first).not.toEqual(second)
    await expect(
      decryptJson(first, key, 'vault-abc', 'document', 'doc-1'),
    ).resolves.toEqual(value)
  })

  it('binds ciphertext to its vault, kind, and object id', async () => {
    const key = randomBytes(32)
    const encrypted = await encryptBytes(
      new TextEncoder().encode('payload'),
      key,
      'vault-a',
      'asset',
      'asset-a',
    )

    await expect(
      decryptBytes(encrypted, key, 'vault-a', 'asset', 'asset-b'),
    ).rejects.toThrow()
    await expect(
      decryptBytes(encrypted, key, 'vault-b', 'asset', 'asset-a'),
    ).rejects.toThrow()
  })

  it('rejects modified ciphertext', async () => {
    const key = randomBytes(32)
    const encrypted = await encryptBytes(
      new TextEncoder().encode('payload'),
      key,
      'vault-a',
      'document',
      'doc-a',
    )
    encrypted[encrypted.length - 1] ^= 1
    await expect(
      decryptBytes(encrypted, key, 'vault-a', 'document', 'doc-a'),
    ).rejects.toThrow()
  })

  it('rejects a payload that inflates beyond the decompression cap', async () => {
    const { gzipSync } = await import('fflate')
    // ~4 KiB stored as a repeatable block inflates past the 1 KiB cap.
    const bomb = gzipSync(new TextEncoder().encode('x'.repeat(4096)))
    await expect(inflateWithLimit(bomb, 1024)).rejects.toThrow(
      /beyond the safe limit/,
    )
    await expect(inflateWithLimit(bomb, 8192)).resolves.toBeTruthy()
  })

  it('keeps the older-Safari fallback bounded while inflating', async () => {
    const { gzipSync } = await import('fflate')
    const bomb = gzipSync(new TextEncoder().encode('x'.repeat(256 * 1024)))
    vi.stubGlobal('DecompressionStream', undefined)

    await expect(inflateWithLimit(bomb, 1024)).rejects.toThrow(
      /beyond the safe limit/,
    )
  })
})
