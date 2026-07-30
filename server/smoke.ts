/** End-to-end API smoke test for a freshly created multi-vault server. */
const base = Bun.env.SYNC_BASE_URL || 'http://127.0.0.1:8787'
const adminToken = Bun.env.SYNC_ADMIN_TOKEN
if (!adminToken) throw new Error('SYNC_ADMIN_TOKEN is required')

const expectStatus = async (response: Response, expected: number) => {
  if (response.status !== expected) {
    throw new Error(`${response.status}: ${await response.text()}`)
  }
  return response
}

const createVault = async (ip: string, deviceLabel: string) => {
  const response = await expectStatus(
    await fetch(`${base}/v1/vaults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ deviceLabel }),
    }),
    201,
  )
  return response.json() as Promise<{
    vaultId: string
    deviceId: string
    deviceToken: string
  }>
}

const created = await createVault('198.51.100.10', 'Smoke test')
const isolated = await createVault('198.51.100.11', 'Isolated smoke test')

await expectStatus(
  await fetch(`${base}/v1/vaults/${isolated.vaultId}/devices`, {
    headers: { Authorization: `Bearer ${created.deviceToken}` },
  }),
  401,
)

await expectStatus(
  await fetch(`${base}/v1/vaults/${isolated.vaultId}/objects/document/${crypto.randomUUID()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${created.deviceToken}` },
  }),
  401,
)
const authorization = { Authorization: `Bearer ${created.deviceToken}` }
const objectId = crypto.randomUUID()
const payload = new TextEncoder().encode('opaque ciphertext')

const uploadedResponse = await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/objects/document/${objectId}`, {
    method: 'PUT',
    headers: {
      ...authorization,
      'Content-Type': 'application/octet-stream',
      'X-Document-Id': objectId,
      'X-Base-Revision': '0',
      'X-Changed-At': String(Date.now()),
      'X-Sync-Operation': 'put',
      'X-Device-Label': 'Smoke test',
    },
    body: payload,
  }),
  201,
)
const uploaded = (await uploadedResponse.json()) as { headRevision: number }
if (uploaded.headRevision !== 1) throw new Error('First object revision was not 1')

const changesResponse = await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/changes?after=0`, {
    headers: authorization,
  }),
  200,
)
const changes = (await changesResponse.json()) as { changes: unknown[]; cursor: number }
if (changes.changes.length !== 1 || changes.cursor < 1) {
  throw new Error('Uploaded object did not appear in the change feed')
}

const downloaded = await expectStatus(
  await fetch(
    `${base}/v1/vaults/${created.vaultId}/objects/document/${objectId}?revision=1`,
    { headers: authorization },
  ),
  200,
)
if (new TextDecoder().decode(await downloaded.arrayBuffer()) !== 'opaque ciphertext') {
  throw new Error('Downloaded object differs from uploaded bytes')
}

const newerTime = Date.now() + 10_000
const newerResponse = await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/objects/document/${objectId}`, {
    method: 'PUT',
    headers: {
      ...authorization,
      'Content-Type': 'application/octet-stream',
      'X-Document-Id': objectId,
      'X-Base-Revision': '1',
      'X-Changed-At': String(newerTime),
      'X-Sync-Operation': 'put',
      'X-Device-Label': 'Newer computer',
    },
    body: new TextEncoder().encode('newer ciphertext'),
  }),
  200,
)
const newer = (await newerResponse.json()) as { headRevision: number }
if (newer.headRevision !== 2) throw new Error('Second revision did not become head')

const staleResponse = await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/objects/document/${objectId}`, {
    method: 'PUT',
    headers: {
      ...authorization,
      'Content-Type': 'application/octet-stream',
      'X-Document-Id': objectId,
      'X-Base-Revision': '1',
      'X-Changed-At': String(newerTime - 5_000),
      'X-Sync-Operation': 'put',
      'X-Device-Label': 'Older offline computer',
    },
    body: new TextEncoder().encode('losing ciphertext'),
  }),
  200,
)
const stale = (await staleResponse.json()) as {
  headRevision: number
  conflictRevision: number
  winner: string
}
if (stale.headRevision !== 2 || stale.conflictRevision !== 3 || stale.winner !== 'existing') {
  throw new Error('Latest-edit-wins conflict metadata is incorrect')
}
const conflict = await expectStatus(
  await fetch(
    `${base}/v1/vaults/${created.vaultId}/objects/document/${objectId}?revision=3`,
    { headers: authorization },
  ),
  200,
)
if (new TextDecoder().decode(await conflict.arrayBuffer()) !== 'losing ciphertext') {
  throw new Error('Losing conflict revision was not retained')
}

const pairingId = crypto.randomUUID()
const pairingTokenBytes = crypto.getRandomValues(new Uint8Array(32))
const pairingToken = Buffer.from(pairingTokenBytes).toString('base64url')
const pairingHash = Buffer.from(
  await crypto.subtle.digest('SHA-256', pairingTokenBytes),
).toString('base64url')
await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/pairings`, {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingId,
      tokenHash: pairingHash,
      wrappedKey: 'opaque-wrapped-key',
      expiresAt: Date.now() + 60_000,
    }),
  }),
  204,
)

const claimResponse = await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/pairings/${pairingId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pairingToken, deviceLabel: 'Paired smoke test' }),
  }),
  201,
)
const claimed = (await claimResponse.json()) as { wrappedKey: string }
if (claimed.wrappedKey !== 'opaque-wrapped-key') throw new Error('Pairing payload changed')

await expectStatus(
  await fetch(`${base}/v1/vaults/${created.vaultId}/pairings/${pairingId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pairingToken, deviceLabel: 'Replay' }),
  }),
  401,
)

const adminAuthorization = { Authorization: `Bearer ${adminToken}` }
const listed = await expectStatus(
  await fetch(`${base}/v1/admin/vaults`, { headers: adminAuthorization }),
  200,
)
const vaults = (await listed.json()) as {
  vaults: Array<{ id: string; quotaBytes: number; activeDevices: number }>
}
if (vaults.vaults.length !== 2 || vaults.vaults.some(vault => vault.quotaBytes <= 0)) {
  throw new Error('Admin vault inventory is incomplete')
}

await expectStatus(
  await fetch(`${base}/v1/admin/vaults/${isolated.vaultId}`, {
    method: 'DELETE',
    headers: adminAuthorization,
  }),
  409,
)
await expectStatus(
  await fetch(`${base}/v1/admin/vaults/${isolated.vaultId}`, {
    method: 'DELETE',
    headers: {
      ...adminAuthorization,
      'X-Confirm-Vault-Id': isolated.vaultId,
    },
  }),
  204,
)
await expectStatus(
  await fetch(`${base}/v1/vaults/${isolated.vaultId}/devices`, {
    headers: { Authorization: `Bearer ${isolated.deviceToken}` },
  }),
  401,
)

console.log('Sync API smoke test passed')
