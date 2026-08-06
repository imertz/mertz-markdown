/**
 * Security regression checks for the sync server.
 *
 * Boots an isolated server on a throwaway port/data dir and asserts the
 * invariants the audit findings demand:
 *   #5  concurrent uploads cannot exceed the vault quota
 *   #9  concurrent same-object revisions retain the winning bytes
 *   #11 sequential pairing claims cannot exceed the active-device cap
 *   #14 delete tombstones cannot create objects out of thin air
 *   plus authenticated request throttling, identity, and feed compaction.
 *
 * Run with: bun run server/security-validations.ts
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 8800 + Math.floor(Math.random() * 500)
const DATA_DIR = await mkdtemp(join(tmpdir(), 'mertz-sync-validation-'))

process.env.SYNC_PORT = String(PORT)
process.env.SYNC_DATA_DIR = DATA_DIR
process.env.SYNC_REGISTRATION_ENABLED = 'true'
process.env.SYNC_RATE_LIMIT_SECRET = 'validation-secret'
process.env.SYNC_VAULT_QUOTA_BYTES = '1000'
process.env.SYNC_MAX_ACTIVE_PAIRINGS = '8'
process.env.SYNC_MAX_ACTIVE_DEVICES = '8'
process.env.SYNC_DEVICE_REQUESTS_PER_MINUTE = '30'

await import('./index.ts')

const base = `http://127.0.0.1:${PORT}`
const results: Array<{ check: string; pass: boolean; detail: string }> = []
const record = (check: string, pass: boolean, detail: string) => {
  results.push({ check, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${check} — ${detail}`)
}

let registrationIp = 7
const register = async (label: string) => {
  registrationIp += 1
  const response = await fetch(`${base}/v1/vaults`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Real-IP': `198.51.100.${registrationIp}`,
    },
    body: JSON.stringify({ deviceLabel: label }),
  })
  if (response.status !== 201) throw new Error(`registration failed: ${await response.text()}`)
  return response.json() as Promise<{
    vaultId: string
    deviceId: string
    deviceToken: string
  }>
}

const putObject = (
  vaultId: string,
  token: string,
  kind: string,
  objectId: string,
  operation: 'put' | 'delete',
  body: Uint8Array,
  baseRevision = 0,
  changedAt = Date.now(),
  docId = objectId,
) =>
  fetch(`${base}/v1/vaults/${vaultId}/objects/${kind}/${objectId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-Document-Id': docId,
      'X-Base-Revision': String(baseRevision),
      'X-Changed-At': String(changedAt),
      'X-Sync-Operation': operation,
      'X-Device-Label': 'validation',
    },
    body,
  })

const usage = async (vaultId: string, token: string): Promise<{ bytes: number }> => {
  const response = await fetch(`${base}/v1/vaults/${vaultId}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as { usage?: { bytes: number } }
  return { bytes: body.usage?.bytes ?? 0 }
}

const uploadJson = async (...args: Parameters<typeof putObject>) => {
  const response = await putObject(...args)
  return {
    response,
    body: (await response.clone().json()) as {
      revision: number
      headRevision: number
    },
  }
}

const vault = await register('Validation')

// #5 — concurrent uploads must not exceed the vault quota.
{
  const quota = 1000
  const payload = new Uint8Array(100)
  const uploads = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      putObject(vault.vaultId, vault.deviceToken, 'document', `doc-${index}`, 'put', payload),
    ),
  )
  const accepted = uploads.filter(response => response.status === 201).length
  const { bytes } = await usage(vault.vaultId, vault.deviceToken)
  record(
    '#5 concurrent quota',
    bytes <= quota,
    `${accepted}/${uploads.length} concurrent puts accepted, ${bytes} bytes stored (quota ${quota})`,
  )
}

// The feed and body fetch are separate requests. Preserve the immediately
// previous ordinary head so one intervening autosave cannot invalidate a
// revision a client has just learned from the feed.
{
  const retentionVault = await register('Revision fetch window')
  const first = await uploadJson(
    retentionVault.vaultId,
    retentionVault.deviceToken,
    'document',
    'retained-head',
    'put',
    new TextEncoder().encode('first'),
    0,
    Date.now(),
  )
  const second = await uploadJson(
    retentionVault.vaultId,
    retentionVault.deviceToken,
    'document',
    'retained-head',
    'put',
    new TextEncoder().encode('second'),
    first.body.headRevision,
    Date.now() + 1,
  )
  const previous = await fetch(
    `${base}/v1/vaults/${retentionVault.vaultId}/objects/document/retained-head?revision=${first.body.revision}`,
    { headers: { Authorization: `Bearer ${retentionVault.deviceToken}` } },
  )
  record(
    'previous-head fetch window',
    first.response.ok && second.response.ok && previous.status === 200,
    `revision ${first.body.revision} remained fetchable after revision ${second.body.revision} (${previous.status})`,
  )
}

// #14 — a delete tombstone for an object that never existed must be a no-op
// that creates no object, revision, or change-feed row.
{
  const changesFeed = async () =>
    (await fetch(`${base}/v1/vaults/${vault.vaultId}/changes?after=0`, {
      headers: { Authorization: `Bearer ${vault.deviceToken}` },
    }).then(response => response.json())) as { changes: unknown[] }

  const before = await changesFeed()
  const usageBefore = await usage(vault.vaultId, vault.deviceToken)

  const tombstone = await putObject(
    vault.vaultId,
    vault.deviceToken,
    'document',
    'ghost-doc',
    'delete',
    new Uint8Array(0),
  )
  const after = await changesFeed()
  const usageAfter = await usage(vault.vaultId, vault.deviceToken)

  record(
    '#14 tombstone of unknown object',
    after.changes.length === before.changes.length &&
      usageAfter.bytes === usageBefore.bytes,
    `delete returned ${tombstone.status}, feed ${before.changes.length}->${after.changes.length}, bytes ${usageBefore.bytes}->${usageAfter.bytes}`,
  )
}

// #9 + feed retention — same-object writes get distinct revisions and the
// winning revision always addresses its own bytes; the feed retains one row.
{
  const raceVault = await register('Same object race')
  const objectId = 'same-object'
  const startedAt = Date.now()
  const payloads = Array.from({ length: 20 }, (_, index) =>
    new TextEncoder().encode(`payload-${String(index).padStart(2, '0')}`),
  )
  const uploads = await Promise.all(
    payloads.map((payload, index) =>
      putObject(
        raceVault.vaultId,
        raceVault.deviceToken,
        'document',
        objectId,
        'put',
        payload,
        0,
        startedAt + index,
      ),
    ),
  )
  const feed = (await fetch(
    `${base}/v1/vaults/${raceVault.vaultId}/changes?after=0`,
    { headers: { Authorization: `Bearer ${raceVault.deviceToken}` } },
  ).then(response => response.json())) as {
    changes: Array<{ revision: number }>
  }
  const headRevision = feed.changes[0]?.revision
  const headResponse = await fetch(
    `${base}/v1/vaults/${raceVault.vaultId}/objects/document/${objectId}?revision=${headRevision}`,
    { headers: { Authorization: `Bearer ${raceVault.deviceToken}` } },
  )
  const head = new Uint8Array(await headResponse.arrayBuffer())
  record(
    '#9 same-object revision race',
    uploads.every(response => response.ok) &&
      headResponse.ok &&
      new TextDecoder().decode(head) === 'payload-19',
    `${uploads.filter(response => response.ok).length}/20 writes succeeded; head revision ${headRevision} contains ${new TextDecoder().decode(head)}`,
  )
  record(
    'change-feed compaction',
    feed.changes.length === 1,
    `${feed.changes.length} current feed row retained for 20 writes`,
  )
}

// Document metadata is part of the identity even for body-less operations.
{
  const identityVault = await register('Identity')
  const response = await putObject(
    identityVault.vaultId,
    identityVault.deviceToken,
    'document',
    'outer-doc',
    'delete',
    new Uint8Array(),
    0,
    Date.now(),
    'inner-doc',
  )
  record(
    'document metadata identity',
    response.status === 400,
    `mismatched document id returned ${response.status}`,
  )
}

// #11 — consuming each link must not evade the active-device cap.
{
  const pairingVault = await register('Pairing cap')
  let created = 0
  let claimed = 0
  for (let index = 0; index < 12; index += 1) {
    const secret = randomBytes(32)
    const pairingId = `pair-${index}`
    const response = await fetch(
      `${base}/v1/vaults/${pairingVault.vaultId}/pairings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pairingVault.deviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairingId,
          tokenHash: createHash('sha256').update(secret).digest('base64url'),
          wrappedKey: `wrapped-${index}`,
          expiresAt: Date.now() + 600_000,
        }),
      },
    )
    if (response.status !== 204) continue
    created += 1
    const claim = await fetch(
      `${base}/v1/vaults/${pairingVault.vaultId}/pairings/${pairingId}/claim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: secret.toString('base64url'),
          deviceLabel: `Claimed ${index}`,
        }),
      },
    )
    if (claim.status === 201) claimed += 1
  }
  const devices = (await fetch(`${base}/v1/vaults/${pairingVault.vaultId}/devices`, {
    headers: { Authorization: `Bearer ${pairingVault.deviceToken}` },
  }).then(response => response.json())) as { devices: unknown[] }
  record(
    '#11 active-device cap',
    created === 7 && claimed === 7 && devices.devices.length === 8,
    `${created} links created, ${claimed} claimed, ${devices.devices.length} active devices`,
  )
}

// Authenticated endpoints share a durable rolling per-device request budget.
{
  const rateVault = await register('Request rate')
  const responses = []
  for (let index = 0; index < 31; index += 1) {
    responses.push(
      await fetch(`${base}/v1/vaults/${rateVault.vaultId}/devices`, {
        headers: { Authorization: `Bearer ${rateVault.deviceToken}` },
      }),
    )
  }
  const limitedResponse = responses.at(-1)
  record(
    'authenticated device rate limit',
    responses.filter(response => response.status === 200).length === 30 &&
      limitedResponse?.status === 429 &&
      Boolean(limitedResponse.headers.get('Retry-After')),
    `${responses.filter(response => response.status === 200).length}/31 accepted; final status ${limitedResponse?.status}`,
  )
}

await rm(DATA_DIR, { recursive: true, force: true })
if (results.some(result => !result.pass)) {
  console.error('\nSecurity validations FAILED')
  process.exit(1)
}
console.log('\nAll security validations passed')
process.exit(0)
