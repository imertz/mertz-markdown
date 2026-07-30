/** Registration policy smoke test. Run against a fresh server configured for 5 vaults. */
const base = Bun.env.SYNC_BASE_URL || 'http://127.0.0.1:8787'
const adminToken = Bun.env.SYNC_ADMIN_TOKEN
if (!adminToken) throw new Error('SYNC_ADMIN_TOKEN is required')

const expectStatus = async (response: Response, expected: number) => {
  if (response.status !== expected) {
    throw new Error(`${response.status}: ${await response.text()}`)
  }
  return response
}

const create = async (ip: string, expected = 201) =>
  expectStatus(
    await fetch(`${base}/v1/vaults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ deviceLabel: 'Registration smoke' }),
    }),
    expected,
  )

const first = (await (await create('203.0.113.10')).json()) as { vaultId: string }
await create('203.0.113.10')
await create('203.0.113.10')
const limited = await create('203.0.113.10', 429)
if (!limited.headers.get('Retry-After')) throw new Error('Rate limit omitted Retry-After')

await create('203.0.113.11')
await create('203.0.113.12')
await create('203.0.113.13', 503)

await expectStatus(
  await fetch(`${base}/v1/admin/vaults`, { headers: { Authorization: 'Bearer invalid' } }),
  401,
)
const authorization = { Authorization: `Bearer ${adminToken}` }
const inventory = (await (
  await expectStatus(await fetch(`${base}/v1/admin/vaults`, { headers: authorization }), 200)
).json()) as {
  vaults: Array<{ id: string; quotaBytes: number }>
  maxVaults: number
}
if (
  inventory.maxVaults !== 5 ||
  inventory.vaults.length !== 5 ||
  inventory.vaults.some(vault => vault.quotaBytes !== 1024)
) {
  throw new Error('Registration capacity or quota metadata is incorrect')
}

await expectStatus(
  await fetch(`${base}/v1/admin/vaults/${first.vaultId}`, {
    method: 'DELETE',
    headers: { ...authorization, 'X-Confirm-Vault-Id': first.vaultId },
  }),
  204,
)

console.log('Registration policy smoke test passed')
