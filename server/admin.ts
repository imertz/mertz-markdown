const base = (Bun.env.SYNC_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const adminToken = Bun.env.SYNC_ADMIN_TOKEN || ''

if (!adminToken) throw new Error('SYNC_ADMIN_TOKEN is required')

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${adminToken}`)
  const response = await fetch(`${base}/v1/admin${path}`, { ...init, headers })
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
  return response
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = -1
  do {
    amount /= 1024
    unit += 1
  } while (amount >= 1024 && unit < units.length - 1)
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`
}

const [command, vaultId, confirmationFlag, confirmationId] = Bun.argv.slice(2)

if (command === 'list') {
  const payload = (await (await request('/vaults')).json()) as {
    vaults: Array<{
      id: string
      createdAt: number
      lastActivityAt: number
      activeDevices: number
      bytes: number
      quotaBytes: number
    }>
    maxVaults: number
    registrationEnabled: boolean
  }
  console.log(
    `Registration: ${payload.registrationEnabled ? 'open' : 'closed'} · ${payload.vaults.length}/${payload.maxVaults} vaults`,
  )
  console.log('VAULT ID\tUSAGE\tDEVICES\tCREATED\tLAST ACTIVITY')
  for (const vault of payload.vaults) {
    console.log(
      [
        vault.id,
        `${bytes(vault.bytes)} / ${bytes(vault.quotaBytes)}`,
        vault.activeDevices,
        new Date(vault.createdAt).toISOString(),
        new Date(vault.lastActivityAt).toISOString(),
      ].join('\t'),
    )
  }
} else if (command === 'delete') {
  if (!vaultId || confirmationFlag !== '--confirm' || confirmationId !== vaultId) {
    throw new Error('Usage: bun run server/admin.ts delete <vault-id> --confirm <vault-id>')
  }
  await request(`/vaults/${encodeURIComponent(vaultId)}`, {
    method: 'DELETE',
    headers: { 'X-Confirm-Vault-Id': vaultId },
  })
  console.log(`Deleted vault ${vaultId}`)
} else {
  throw new Error(
    'Usage: bun run server/admin.ts list | delete <vault-id> --confirm <vault-id>',
  )
}
