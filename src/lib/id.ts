/**
 * `crypto.randomUUID` is only exposed in a secure context, so it exists on
 * localhost and HTTPS but not when the dev server is reached over a bare LAN
 * IP. Fall back to `getRandomValues`, and only then to Math.random.
 */
export function createId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      // RFC 4122 version 4 / variant 10xx.
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
      const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
      ].join('-')
    }
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
