import { Database } from 'bun:sqlite'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const PORT = Number(Bun.env.SYNC_PORT || 8787)
const DATA_DIR = Bun.env.SYNC_DATA_DIR || './sync-data'
const ADMIN_TOKEN = Bun.env.SYNC_ADMIN_TOKEN || ''
const RATE_LIMIT_SECRET = Bun.env.SYNC_RATE_LIMIT_SECRET || ''
const REGISTRATION_ENABLED = Bun.env.SYNC_REGISTRATION_ENABLED === 'true'
const MAX_VAULTS = Number(Bun.env.SYNC_MAX_VAULTS || 80)
const VAULT_QUOTA_BYTES = Number(Bun.env.SYNC_VAULT_QUOTA_BYTES || 500 * 1024 ** 2)
const REGISTRATION_ATTEMPTS_PER_HOUR = Number(
  Bun.env.SYNC_REGISTRATION_ATTEMPTS_PER_HOUR || 10,
)
const REGISTRATIONS_PER_IP_PER_DAY = Number(
  Bun.env.SYNC_REGISTRATIONS_PER_IP_PER_DAY || 3,
)
const ALLOWED_ORIGINS = new Set(
  (Bun.env.SYNC_ALLOWED_ORIGINS || 'https://markdown.mysolon.gr,http://localhost:5173')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
)
const MAX_OBJECT_BYTES = Number(Bun.env.SYNC_MAX_OBJECT_BYTES || 30 * 1024 * 1024)
const MAX_ACTIVE_PAIRINGS = Number(Bun.env.SYNC_MAX_ACTIVE_PAIRINGS || 8)
const MAX_ACTIVE_DEVICES = Number(Bun.env.SYNC_MAX_ACTIVE_DEVICES || 8)
const DEVICE_REQUESTS_PER_MINUTE = Number(
  Bun.env.SYNC_DEVICE_REQUESTS_PER_MINUTE || 600,
)
const RECENT_NON_CONFLICT_REVISIONS = 1
const TOMBSTONE_BODY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const ID = /^[A-Za-z0-9_-]{1,128}$/

if (REGISTRATION_ENABLED && !RATE_LIMIT_SECRET) {
  throw new Error('SYNC_RATE_LIMIT_SECRET is required when registration is enabled')
}
if (
  !Number.isSafeInteger(MAX_VAULTS) ||
  MAX_VAULTS < 1 ||
  !Number.isSafeInteger(VAULT_QUOTA_BYTES) ||
  VAULT_QUOTA_BYTES < 1 ||
  !Number.isSafeInteger(REGISTRATION_ATTEMPTS_PER_HOUR) ||
  REGISTRATION_ATTEMPTS_PER_HOUR < 1 ||
  !Number.isSafeInteger(REGISTRATIONS_PER_IP_PER_DAY) ||
  REGISTRATIONS_PER_IP_PER_DAY < 1 ||
  !Number.isSafeInteger(MAX_ACTIVE_PAIRINGS) ||
  MAX_ACTIVE_PAIRINGS < 1 ||
  !Number.isSafeInteger(MAX_ACTIVE_DEVICES) ||
  MAX_ACTIVE_DEVICES < 1 ||
  !Number.isSafeInteger(DEVICE_REQUESTS_PER_MINUTE) ||
  DEVICE_REQUESTS_PER_MINUTE < 1
) {
  throw new Error('Invalid sync server limits')
}

await mkdir(join(DATA_DIR, 'objects'), { recursive: true })
const db = new Database(join(DATA_DIR, 'sync.sqlite'), { create: true, strict: true })
db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS devices_vault ON devices(vault_id);
  CREATE TABLE IF NOT EXISTS pairings (
    id TEXT NOT NULL,
    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    PRIMARY KEY (vault_id, id)
  );
  CREATE TABLE IF NOT EXISTS objects (
    vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    head_revision INTEGER NOT NULL,
    head_changed_at INTEGER NOT NULL,
    head_deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vault_id, kind, object_id)
  );
  CREATE TABLE IF NOT EXISTS revisions (
    vault_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    doc_id TEXT NOT NULL,
    changed_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_label TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    path TEXT,
    size INTEGER NOT NULL,
    is_conflict INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vault_id, kind, object_id, revision)
  );
  CREATE TABLE IF NOT EXISTS changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    object_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL,
    conflict_revision INTEGER,
    device_label TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS changes_vault_seq ON changes(vault_id, seq);
  CREATE TABLE IF NOT EXISTS registration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    attempted_at INTEGER NOT NULL,
    successful INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS registration_events_ip_time
    ON registration_events(ip_hash, attempted_at);
  CREATE TABLE IF NOT EXISTS device_request_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS device_request_events_device_time
    ON device_request_events(device_id, requested_at);
`)

const vaultColumns = db.query('PRAGMA table_info(vaults)').all() as Array<{ name: string }>
if (!vaultColumns.some(column => column.name === 'quota_bytes')) {
  db.run('ALTER TABLE vaults ADD COLUMN quota_bytes INTEGER')
}
db.query('UPDATE vaults SET quota_bytes = ? WHERE quota_bytes IS NULL').run(VAULT_QUOTA_BYTES)

type Row = Record<string, string | number | null>

const now = () => Date.now()
const token = () => randomBytes(32).toString('base64url')
const identifier = () => randomBytes(16).toString('base64url')
const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('base64url')

const hashIp = (value: string) =>
  createHmac('sha256', RATE_LIMIT_SECRET).update(value).digest('base64url')

function hashPairingToken(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) return null
  return createHash('sha256').update(bytes).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization') || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

function authenticateAdmin(request: Request): boolean {
  const supplied = bearerToken(request)
  return Boolean(
    ADMIN_TOKEN && supplied && safeEqual(hashToken(supplied), hashToken(ADMIN_TOKEN)),
  )
}

function json(value: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders(request, { 'Content-Type': 'application/json' }),
  })
}

function text(value: string, status: number, request?: Request): Response {
  return new Response(value, { status, headers: responseHeaders(request) })
}

function limited(value: string, retryAfterSeconds: number, request: Request): Response {
  return new Response(value, {
    status: 429,
    headers: responseHeaders(request, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
  })
}

function responseHeaders(
  request?: Request,
  extra: Record<string, string> = {},
): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  })
  const origin = request?.headers.get('Origin')
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return headers
}

function preflight(request: Request): Response {
  const origin = request.headers.get('Origin')
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return text('Origin not allowed', 403)
  return new Response(null, {
    status: 204,
    headers: responseHeaders(request, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization,Content-Type,X-Confirm-Vault-Id,X-Document-Id,X-Base-Revision,X-Changed-At,X-Sync-Operation,X-Device-Label',
      'Access-Control-Max-Age': '86400',
    }),
  })
}

function parseJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get('Content-Length') || 0)
  if (length > 64 * 1024) throw new Error('Request metadata is too large')
  return request.json() as Promise<T>
}

function validateId(value: string | undefined, label: string): string {
  if (!value || !ID.test(value)) throw new Error(`Invalid ${label}`)
  return value
}

function authenticate(request: Request, vaultId: string): Row | null {
  const token = bearerToken(request)
  if (!token) return null
  const supplied = hashToken(token)
  const devices = db
    .query('SELECT * FROM devices WHERE vault_id = ? AND revoked_at IS NULL')
    .all(vaultId) as Row[]
  return devices.find(row => safeEqual(String(row.token_hash), supplied)) ?? null
}

type DeviceAdmission = { allowed: true } | { allowed: false; retryAfter: number }

function admitDeviceRequest(device: Row): DeviceAdmission {
  const requestedAt = now()
  return db.transaction((): DeviceAdmission => {
    const cutoff = requestedAt - 60_000
    db.query(
      'DELETE FROM device_request_events WHERE device_id = ? AND requested_at < ?',
    ).run(device.id, cutoff)
    const usage = db
      .query(
        'SELECT COUNT(*) AS count, MIN(requested_at) AS oldest FROM device_request_events WHERE device_id = ? AND requested_at >= ?',
      )
      .get(device.id, cutoff) as Row
    if (Number(usage.count) >= DEVICE_REQUESTS_PER_MINUTE) {
      return {
        allowed: false,
        retryAfter: (Number(usage.oldest || requestedAt) + 60_000 - requestedAt) / 1000,
      }
    }
    db.query(
      'INSERT INTO device_request_events (device_id, requested_at) VALUES (?, ?)',
    ).run(device.id, requestedAt)
    db.query('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(requestedAt, device.id)
    return { allowed: true }
  })()
}

function expireDeviceRequestEvents(): void {
  db.query('DELETE FROM device_request_events WHERE requested_at < ?').run(now() - 60_000)
}

function objectBlobPath(
  vaultId: string,
  kind: string,
  objectId: string,
): string {
  return join(DATA_DIR, 'objects', vaultId, kind, objectId, `${identifier()}.bin`)
}

async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${identifier()}.tmp`
  try {
    await writeFile(temporary, bytes, { mode: 0o600 })
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function removeRevision(row: Row | null): Promise<void> {
  if (!row) return
  const removed = db.transaction(() => {
    const object = db
      .query(
        'SELECT head_revision FROM objects WHERE vault_id = ? AND kind = ? AND object_id = ?',
      )
      .get(row.vault_id, row.kind, row.object_id) as Row | null
    if (object && Number(object.head_revision) === Number(row.revision)) return false
    const result = db.query(
      'DELETE FROM revisions WHERE vault_id = ? AND kind = ? AND object_id = ? AND revision = ?',
    ).run(row.vault_id, row.kind, row.object_id, row.revision)
    return result.changes > 0
  })()
  if (removed && row.path) await unlink(String(row.path)).catch(() => undefined)
}

async function pruneRevisions(
  vaultId: string,
  kind: string,
  objectId: string,
): Promise<void> {
  const object = db
    .query(
      'SELECT head_revision FROM objects WHERE vault_id = ? AND kind = ? AND object_id = ?',
    )
    .get(vaultId, kind, objectId) as Row | null
  if (!object) return
  const headRevision = Number(object.head_revision)
  const superseded = db
    .query(
      `SELECT * FROM revisions
       WHERE vault_id = ? AND kind = ? AND object_id = ?
         AND revision != ? AND is_conflict = 0
       ORDER BY received_at DESC, revision DESC`,
    )
    .all(vaultId, kind, objectId, headRevision) as Row[]
  // Keep one immediately previous ordinary head. A client first reads the
  // change feed and then fetches that exact revision; without this short
  // window, one autosave landing between those requests makes a valid feed
  // entry answer 404. Conflicts have their own bounded retention below.
  for (const row of superseded.slice(RECENT_NON_CONFLICT_REVISIONS)) {
    await removeRevision(row)
  }

  if (kind !== 'document') return
  const conflicts = db
    .query(
      `SELECT * FROM revisions
       WHERE vault_id = ? AND kind = 'document' AND object_id = ? AND is_conflict = 1
       ORDER BY received_at DESC`,
    )
    .all(vaultId, objectId) as Row[]
  for (const row of conflicts.slice(50)) await removeRevision(row)
}

async function garbageCollectDeletedDocuments(): Promise<void> {
  const deleted = db
    .query(
      `SELECT o.*, r.received_at
       FROM objects o
       JOIN revisions r ON r.vault_id = o.vault_id AND r.kind = o.kind
         AND r.object_id = o.object_id AND r.revision = o.head_revision
       WHERE o.kind = 'document' AND o.head_deleted = 1 AND r.received_at < ?`,
    )
    .all(now() - TOMBSTONE_BODY_TTL_MS) as Row[]

  for (const document of deleted) {
    const documentRevisions = db
      .query(
        `SELECT * FROM revisions
         WHERE vault_id = ? AND kind = 'document' AND object_id = ? AND revision != ?`,
      )
      .all(document.vault_id, document.object_id, document.head_revision) as Row[]
    const assets = db
      .query("SELECT * FROM objects WHERE vault_id = ? AND kind = 'asset' AND doc_id = ?")
      .all(document.vault_id, document.object_id) as Row[]

    for (const revision of documentRevisions) await removeRevision(revision)
    for (const asset of assets) {
      const revisions = db
        .query(
          "SELECT * FROM revisions WHERE vault_id = ? AND kind = 'asset' AND object_id = ?",
        )
        .all(asset.vault_id, asset.object_id) as Row[]
      db.query(
        "DELETE FROM objects WHERE vault_id = ? AND kind = 'asset' AND object_id = ?",
      ).run(asset.vault_id, asset.object_id)
      for (const revision of revisions) await removeRevision(revision)
    }
  }
}

/**
 * Clear out phantom asset tombstones written by earlier builds.
 *
 * Before a delete naming an unknown object became a no-op, a device could make
 * an asset's *first* write a delete and leave a body-less tombstone in the
 * change feed. Fetching it answers 404, which stalled the sync cursor on every
 * client that saw it. Assets are immutable once written, so a deleted asset
 * head can only be one of these phantoms — and the `path IS NOT NULL` guard
 * means nothing with actual bytes behind it is ever touched.
 */
function removePhantomAssetTombstones(): void {
  const phantoms = db
    .query(
      `SELECT o.vault_id AS vault_id, o.object_id AS object_id
       FROM objects o
       WHERE o.kind = 'asset' AND o.head_deleted = 1
         AND NOT EXISTS (
           SELECT 1 FROM revisions r
           WHERE r.vault_id = o.vault_id AND r.kind = 'asset'
             AND r.object_id = o.object_id AND r.path IS NOT NULL
         )`,
    )
    .all() as Row[]
  if (!phantoms.length) return

  db.transaction(() => {
    for (const row of phantoms) {
      for (const table of ['changes', 'revisions', 'objects']) {
        db.query(
          `DELETE FROM ${table} WHERE vault_id = ? AND kind = 'asset' AND object_id = ?`,
        ).run(row.vault_id, row.object_id)
      }
    }
  })()
  console.log(`[sync-server] removed ${phantoms.length} phantom asset tombstone(s)`)
}

/** Keep the feed as a current-state index rather than an unbounded event log. */
function compactChangeFeed(): void {
  const result = db.query(
    `DELETE FROM changes
     WHERE seq NOT IN (
       SELECT MAX(seq) FROM changes GROUP BY vault_id, kind, object_id
     )`,
  ).run()
  if (result.changes) {
    console.log(`[sync-server] compacted ${result.changes} superseded change(s)`)
  }
}

/** Remove completed temporary/orphaned blobs left by a crash before DB commit. */
async function removeOrphanObjectFiles(): Promise<void> {
  const referenced = new Set(
    (db.query('SELECT path FROM revisions WHERE path IS NOT NULL').all() as Row[])
      .map(row => String(row.path)),
  )
  const root = join(DATA_DIR, 'objects')
  let removed = 0

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (!referenced.has(path)) {
        await unlink(path).catch(() => undefined)
        removed += 1
      }
    }
  }

  await walk(root)
  if (removed) console.log(`[sync-server] removed ${removed} orphaned object file(s)`)
}

function vaultBytes(vaultId: string): number {
  const row = db
    .query('SELECT COALESCE(SUM(size), 0) AS total FROM revisions WHERE vault_id = ?')
    .get(vaultId) as Row
  return Number(row.total)
}

function vaultQuota(vaultId: string): number {
  const row = db.query('SELECT quota_bytes FROM vaults WHERE id = ?').get(vaultId) as Row | null
  return Number(row?.quota_bytes || 0)
}

function registrationIp(request: Request): string | null {
  const value = request.headers.get('X-Real-IP')?.trim() || ''
  return value && value.length <= 64 && !/[\s,]/.test(value) ? value : null
}

type RegistrationResult =
  | {
      created: {
        vaultId: string
        deviceId: string
        deviceToken: string
      }
    }
  | { error: string; status: 429 | 503; retryAfter?: number }

async function createVault(request: Request): Promise<Response> {
  if (!REGISTRATION_ENABLED) return text('New vault registration is currently closed', 503, request)
  const ip = registrationIp(request)
  if (!ip) return text('Registration requires a trusted client address', 400, request)
  const body = await parseJson<{ deviceLabel?: string }>(request)
  const ipHash = hashIp(ip)
  const createdAt = now()
  const result = db.transaction((): RegistrationResult => {
    db.query('DELETE FROM registration_events WHERE attempted_at < ?').run(createdAt - DAY_MS)

    const hourly = db
      .query(
        'SELECT COUNT(*) AS count, MIN(attempted_at) AS oldest FROM registration_events WHERE ip_hash = ? AND attempted_at >= ?',
      )
      .get(ipHash, createdAt - HOUR_MS) as Row
    if (Number(hourly.count) >= REGISTRATION_ATTEMPTS_PER_HOUR) {
      return {
        error: 'Too many registration attempts from this network',
        status: 429,
        retryAfter: (Number(hourly.oldest) + HOUR_MS - createdAt) / 1000,
      }
    }

    const event = db
      .query('INSERT INTO registration_events (ip_hash, attempted_at) VALUES (?, ?) RETURNING id')
      .get(ipHash, createdAt) as Row
    const daily = db
      .query(
        'SELECT COUNT(*) AS count, MIN(attempted_at) AS oldest FROM registration_events WHERE ip_hash = ? AND successful = 1 AND attempted_at >= ?',
      )
      .get(ipHash, createdAt - DAY_MS) as Row
    if (Number(daily.count) >= REGISTRATIONS_PER_IP_PER_DAY) {
      return {
        error: 'This network has reached its daily vault limit',
        status: 429,
        retryAfter: (Number(daily.oldest) + DAY_MS - createdAt) / 1000,
      }
    }

    const count = db.query('SELECT COUNT(*) AS count FROM vaults').get() as Row
    if (Number(count.count) >= MAX_VAULTS) {
      return { error: 'New vault registration has reached server capacity', status: 503 }
    }

    const vaultId = identifier()
    const deviceId = identifier()
    const deviceToken = token()
    db.query('INSERT INTO vaults (id, created_at, quota_bytes) VALUES (?, ?, ?)').run(
      vaultId,
      createdAt,
      VAULT_QUOTA_BYTES,
    )
    db.query(
      'INSERT INTO devices (id, vault_id, token_hash, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      deviceId,
      vaultId,
      hashToken(deviceToken),
      String(body.deviceLabel || 'First computer').slice(0, 120),
      createdAt,
      createdAt,
    )
    db.query('UPDATE registration_events SET successful = 1 WHERE id = ?').run(event.id)
    return { created: { vaultId, deviceId, deviceToken } }
  })()

  if ('error' in result) {
    return result.status === 429
      ? limited(result.error, result.retryAfter || HOUR_MS / 1000, request)
      : text(result.error, result.status, request)
  }
  return json({ ...result.created, serverTime: now() }, 201, request)
}

function activePairingCount(vaultId: string): number {
  const row = db
    .query(
      'SELECT COUNT(*) AS count FROM pairings WHERE vault_id = ? AND expires_at >= ? AND used_at IS NULL',
    )
    .get(vaultId, now()) as Row
  return Number(row.count)
}

function activeDeviceCount(vaultId: string): number {
  const row = db
    .query(
      'SELECT COUNT(*) AS count FROM devices WHERE vault_id = ? AND revoked_at IS NULL',
    )
    .get(vaultId) as Row
  return Number(row.count)
}

function expirePairings(): void {
  db.query('DELETE FROM pairings WHERE expires_at < ? OR used_at IS NOT NULL').run(now())
}

async function createPairing(request: Request, vaultId: string, device: Row): Promise<Response> {
  void device
  const body = await parseJson<{
    pairingId?: string
    tokenHash?: string
    wrappedKey?: string
    expiresAt?: number
  }>(request)
  const pairingId = validateId(body.pairingId, 'pairing id')
  if (!body.tokenHash || !body.wrappedKey) throw new Error('Incomplete pairing request')
  const expiresAt = Math.min(Number(body.expiresAt || 0), now() + 10 * 60 * 1000)
  if (expiresAt <= now()) throw new Error('Pairing expiry must be in the future')

  const result = db.transaction((): 'created' | 'devices-full' | 'pairings-full' | 'exists' => {
    db.query('DELETE FROM pairings WHERE vault_id = ? AND expires_at < ?').run(vaultId, now())
    if (activeDeviceCount(vaultId) >= MAX_ACTIVE_DEVICES) return 'devices-full'
    if (activePairingCount(vaultId) >= MAX_ACTIVE_PAIRINGS) return 'pairings-full'
    const inserted = db.query(
      `INSERT INTO pairings (id, vault_id, token_hash, wrapped_key, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(vault_id, id) DO NOTHING`,
    ).run(pairingId, vaultId, body.tokenHash, body.wrappedKey, expiresAt)
    return inserted.changes ? 'created' : 'exists'
  })()

  if (result === 'devices-full') {
    return text('Revoke a computer before adding another one', 409, request)
  }
  if (result === 'pairings-full') {
    return text('This vault already has the maximum number of pending pairing links', 429, request)
  }
  if (result === 'exists') return text('Pairing id already exists', 409, request)
  return new Response(null, { status: 204, headers: responseHeaders(request) })
}

async function claimPairing(
  request: Request,
  vaultId: string,
  pairingId: string,
): Promise<Response> {
  const body = await parseJson<{ token?: string; deviceLabel?: string }>(request)
  const suppliedHash = body.token ? hashPairingToken(body.token) : null
  const deviceId = identifier()
  const deviceToken = token()
  const createdAt = now()
  const label = String(body.deviceLabel || 'Computer').slice(0, 120)
  type ClaimResult =
    | { status: 'created'; wrappedKey: string }
    | {
        status: 'invalid'
        found: boolean
        used: boolean
        expired: boolean
        tokenMatches: boolean
      }
    | { status: 'devices-full' }

  const result = db.transaction((): ClaimResult => {
    const pairing = db
      .query('SELECT * FROM pairings WHERE vault_id = ? AND id = ?')
      .get(vaultId, pairingId) as Row | null
    const used = Boolean(pairing && pairing.used_at !== null)
    const expired = pairing ? Number(pairing.expires_at) < createdAt : false
    const tokenMatches = Boolean(
      pairing && suppliedHash && safeEqual(String(pairing.token_hash), suppliedHash),
    )
    if (!pairing || used || expired || !tokenMatches) {
      return {
        status: 'invalid',
        found: Boolean(pairing),
        used,
        expired,
        tokenMatches,
      }
    }
    if (activeDeviceCount(vaultId) >= MAX_ACTIVE_DEVICES) {
      return { status: 'devices-full' }
    }
    db.query(
      'INSERT INTO devices (id, vault_id, token_hash, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(deviceId, vaultId, hashToken(deviceToken), label, createdAt, createdAt)
    db.query('DELETE FROM pairings WHERE vault_id = ? AND id = ?').run(vaultId, pairingId)
    return { status: 'created', wrappedKey: String(pairing.wrapped_key) }
  })()

  if (result.status === 'invalid') {
    // Do not log the token or either hash. These booleans are sufficient to
    // distinguish a malformed URL from expiry and authentication failures.
    console.warn('[sync-server] pairing rejected', {
      vaultId,
      pairingId,
      found: result.found,
      used: result.used,
      expired: result.expired,
      tokenSupplied: Boolean(body.token),
      tokenMatches: result.tokenMatches,
    })
    return text('Pairing link is invalid, expired, or already used', 401, request)
  }
  if (result.status === 'devices-full') {
    return text('Revoke a computer before adding another one', 409, request)
  }
  return json(
    {
      vaultId,
      deviceId,
      deviceToken,
      deviceLabel: label,
      wrappedKey: result.wrappedKey,
    },
    201,
    request,
  )
}

async function putObject(
  request: Request,
  vaultId: string,
  kind: 'document' | 'asset',
  objectId: string,
  device: Row,
): Promise<Response> {
  const contentLength = Number(request.headers.get('Content-Length') || 0)
  if (contentLength > MAX_OBJECT_BYTES) return text('Encrypted object is too large', 413, request)
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_OBJECT_BYTES) return text('Encrypted object is too large', 413, request)

  const docId = validateId(request.headers.get('X-Document-Id') || undefined, 'document id')
  if (kind === 'document' && docId !== objectId) {
    throw new Error('Document id must match its object id')
  }
  const baseRevision = Number(request.headers.get('X-Base-Revision') || 0)
  const changedAt = Number(request.headers.get('X-Changed-At') || 0)
  const operation = request.headers.get('X-Sync-Operation')
  const deleted = operation === 'delete'
  if (
    !Number.isSafeInteger(baseRevision) ||
    baseRevision < 0 ||
    !Number.isFinite(changedAt) ||
    changedAt <= 0 ||
    (operation !== 'put' && !deleted)
  ) {
    throw new Error('Invalid object metadata')
  }
  if (!deleted && bytes.byteLength === 0) throw new Error('Encrypted object is empty')
  if (deleted && bytes.byteLength !== 0) throw new Error('Delete requests must have an empty body')
  if (!deleted && vaultBytes(vaultId) + bytes.byteLength > vaultQuota(vaultId)) {
    return text('Vault storage quota exceeded', 413, request)
  }

  const fastCurrent = db
    .query('SELECT * FROM objects WHERE vault_id = ? AND kind = ? AND object_id = ?')
    .get(vaultId, kind, objectId) as Row | null
  if (kind === 'asset' && fastCurrent) {
    return json({
      revision: fastCurrent.head_revision,
      headRevision: fastCurrent.head_revision,
      winner: 'existing',
      conflictRevision: null,
      seq: 0,
      noOp: false,
    }, 200, request)
  }

  const stagedPath = deleted ? null : objectBlobPath(vaultId, kind, objectId)
  if (stagedPath) await writeAtomic(stagedPath, bytes)
  const deviceLabel = String(request.headers.get('X-Device-Label') || device.label).slice(0, 120)
  type PutResult =
    | { status: 'quota' }
    | { status: 'no-op' }
    | { status: 'existing'; revision: number }
    | {
        status: 'stored'
        revision: number
        headRevision: number
        submittedWins: boolean
        conflictRevision: number | null
        sequence: number
        existed: boolean
      }

  let result: PutResult
  try {
    result = db.transaction((): PutResult => {
      const current = db
        .query('SELECT * FROM objects WHERE vault_id = ? AND kind = ? AND object_id = ?')
        .get(vaultId, kind, objectId) as Row | null
      if (kind === 'asset' && current) {
        return { status: 'existing', revision: Number(current.head_revision) }
      }
      if (deleted && !current) return { status: 'no-op' }
      if (!deleted && vaultBytes(vaultId) + bytes.byteLength > vaultQuota(vaultId)) {
        return { status: 'quota' }
      }

      const latestRevision = db
        .query(
          'SELECT COALESCE(MAX(revision), 0) AS revision FROM revisions WHERE vault_id = ? AND kind = ? AND object_id = ?',
        )
        .get(vaultId, kind, objectId) as Row
      const revision = Number(latestRevision.revision) + 1
      const stale = current !== null && baseRevision !== Number(current.head_revision)
      const submittedWins = !stale || changedAt >= Number(current?.head_changed_at || 0)
      const headRevision = submittedWins ? revision : Number(current?.head_revision)
      const conflictRevision = stale
        ? submittedWins
          ? Number(current?.head_revision)
          : revision
        : null

      db.query(
        `INSERT INTO revisions
         (vault_id, kind, object_id, revision, doc_id, changed_at, received_at, device_id, device_label, deleted, path, size, is_conflict)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        vaultId,
        kind,
        objectId,
        revision,
        docId,
        changedAt,
        now(),
        device.id,
        deviceLabel,
        deleted ? 1 : 0,
        stagedPath,
        bytes.byteLength,
        stale && !submittedWins ? 1 : 0,
      )

      if (submittedWins) {
        if (stale && current) {
          db.query(
            'UPDATE revisions SET is_conflict = 1 WHERE vault_id = ? AND kind = ? AND object_id = ? AND revision = ?',
          ).run(vaultId, kind, objectId, current.head_revision)
        }
        db.query(
          `INSERT INTO objects (vault_id, kind, object_id, doc_id, head_revision, head_changed_at, head_deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(vault_id, kind, object_id) DO UPDATE SET
             doc_id = excluded.doc_id,
             head_revision = excluded.head_revision,
             head_changed_at = excluded.head_changed_at,
             head_deleted = excluded.head_deleted`,
        ).run(vaultId, kind, objectId, docId, revision, changedAt, deleted ? 1 : 0)
      }

      const head = db
        .query(
          'SELECT doc_id, device_label, changed_at, deleted FROM revisions WHERE vault_id = ? AND kind = ? AND object_id = ? AND revision = ?',
        )
        .get(vaultId, kind, objectId, headRevision) as Row
      const inserted = db.query(
        `INSERT INTO changes
         (vault_id, kind, object_id, doc_id, revision, changed_at, deleted, conflict_revision, device_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING seq`,
      ).get(
        vaultId,
        kind,
        objectId,
        head.doc_id ?? docId,
        headRevision,
        head.changed_at,
        head.deleted,
        conflictRevision,
        head.device_label,
      ) as Row
      const sequence = Number(inserted.seq)
      db.query(
        'DELETE FROM changes WHERE vault_id = ? AND kind = ? AND object_id = ? AND seq != ?',
      ).run(vaultId, kind, objectId, sequence)
      return {
        status: 'stored',
        revision,
        headRevision,
        submittedWins,
        conflictRevision,
        sequence,
        existed: current !== null,
      }
    })()
  } catch (error) {
    if (stagedPath) await unlink(stagedPath).catch(() => undefined)
    throw error
  }

  if (result.status !== 'stored' && stagedPath) {
    await unlink(stagedPath).catch(() => undefined)
  }
  if (result.status === 'quota') return text('Vault storage quota exceeded', 413, request)
  if (result.status === 'no-op') {
    return json({
      revision: 0,
      headRevision: 0,
      winner: 'existing',
      conflictRevision: null,
      seq: 0,
      noOp: true,
    }, 200, request)
  }
  if (result.status === 'existing') {
    return json({
      revision: result.revision,
      headRevision: result.revision,
      winner: 'existing',
      conflictRevision: null,
      seq: 0,
      noOp: false,
    }, 200, request)
  }

  await pruneRevisions(vaultId, kind, objectId)
  return json(
    {
      revision: result.revision,
      headRevision: result.headRevision,
      winner: result.submittedWins ? 'submitted' : 'existing',
      conflictRevision: result.conflictRevision,
      seq: result.sequence,
      noOp: false,
    },
    result.existed ? 200 : 201,
    request,
  )
}

async function getObject(
  request: Request,
  vaultId: string,
  kind: string,
  objectId: string,
  revisionParam: string | null,
): Promise<Response> {
  const object = db
    .query('SELECT * FROM objects WHERE vault_id = ? AND kind = ? AND object_id = ?')
    .get(vaultId, kind, objectId) as Row | null
  if (!object) return text('Object not found', 404, request)
  const revision = revisionParam ? Number(revisionParam) : Number(object.head_revision)
  const row = db
    .query(
      'SELECT * FROM revisions WHERE vault_id = ? AND kind = ? AND object_id = ? AND revision = ?',
    )
    .get(vaultId, kind, objectId, revision) as Row | null
  if (!row || row.deleted || !row.path) return text('Object revision has no body', 404, request)
  const bytes = await readFile(String(row.path))
  return new Response(bytes, {
    headers: responseHeaders(request, { 'Content-Type': 'application/octet-stream' }),
  })
}

function listChanges(request: Request, vaultId: string, after: number): Response {
  const rows = db
    .query(
      `SELECT c.* FROM changes c
       JOIN (
         SELECT kind, object_id, MAX(seq) AS max_seq
         FROM changes WHERE vault_id = ? AND seq > ?
         GROUP BY kind, object_id
       ) latest ON latest.max_seq = c.seq
       WHERE NOT (
         c.kind = 'asset' AND EXISTS (
           SELECT 1 FROM objects d
           WHERE d.vault_id = c.vault_id AND d.kind = 'document'
             AND d.object_id = c.doc_id AND d.head_deleted = 1
         )
       )
       ORDER BY c.seq ASC`,
    )
    .all(vaultId, after) as Row[]
  const cursor = db
    .query('SELECT COALESCE(MAX(seq), ?) AS cursor FROM changes WHERE vault_id = ?')
    .get(after, vaultId) as Row
  return json(
    {
      changes: rows.map(row => {
        const conflictRows =
          row.kind === 'document'
            ? (db
                .query(
                  `SELECT revision FROM revisions
                   WHERE vault_id = ? AND kind = 'document' AND object_id = ? AND is_conflict = 1
                   ORDER BY received_at DESC LIMIT 50`,
                )
                .all(vaultId, row.object_id) as Row[])
            : []
        return {
          seq: Number(row.seq),
          kind: row.kind,
          objectId: row.object_id,
          docId: row.doc_id,
          revision: Number(row.revision),
          changedAt: Number(row.changed_at),
          deleted: Boolean(row.deleted),
          conflictRevision:
            row.conflict_revision == null ? null : Number(row.conflict_revision),
          conflictRevisions: conflictRows.map(conflict => Number(conflict.revision)),
          deviceLabel: row.device_label,
        }
      }),
      cursor: Number(cursor.cursor),
      serverTime: now(),
    },
    200,
    request,
  )
}

function listDevices(request: Request, vaultId: string, current: Row): Response {
  const rows = db
    .query(
      'SELECT id, label, created_at, last_seen_at FROM devices WHERE vault_id = ? AND revoked_at IS NULL ORDER BY created_at',
    )
    .all(vaultId) as Row[]
  return json(
    {
      devices: rows.map(row => ({
        id: row.id,
        label: row.label,
        createdAt: Number(row.created_at),
        lastSeenAt: Number(row.last_seen_at),
        current: row.id === current.id,
      })),
      /* Piggy-backed on the device list rather than given its own route: the
         panel that shows the allowance is the same one that lists devices, so
         this costs no extra round trip. */
      usage: { bytes: vaultBytes(vaultId), quotaBytes: vaultQuota(vaultId) },
    },
    200,
    request,
  )
}

function revokeDevice(request: Request, vaultId: string, deviceId: string, current: Row): Response {
  if (deviceId === current.id) return text('Use local forget for this computer', 409, request)
  const count = db
    .query('SELECT COUNT(*) AS count FROM devices WHERE vault_id = ? AND revoked_at IS NULL')
    .get(vaultId) as Row
  if (Number(count.count) <= 1) return text('The final device cannot be revoked', 409, request)
  const result = db
    .query('UPDATE devices SET revoked_at = ? WHERE vault_id = ? AND id = ? AND revoked_at IS NULL')
    .run(now(), vaultId, deviceId)
  if (!result.changes) return text('Device not found', 404, request)
  return new Response(null, { status: 204, headers: responseHeaders(request) })
}

function listVaultsForAdmin(request: Request): Response {
  const vaults = db.query('SELECT id, created_at, quota_bytes FROM vaults ORDER BY created_at').all() as Row[]
  return json(
    {
      vaults: vaults.map(vault => {
        const usage = db
          .query('SELECT COALESCE(SUM(size), 0) AS bytes, MAX(received_at) AS activity FROM revisions WHERE vault_id = ?')
          .get(vault.id) as Row
        const devices = db
          .query('SELECT COUNT(*) AS count, MAX(last_seen_at) AS activity FROM devices WHERE vault_id = ? AND revoked_at IS NULL')
          .get(vault.id) as Row
        return {
          id: vault.id,
          createdAt: Number(vault.created_at),
          lastActivityAt: Math.max(
            Number(vault.created_at),
            Number(usage.activity || 0),
            Number(devices.activity || 0),
          ),
          activeDevices: Number(devices.count),
          bytes: Number(usage.bytes),
          quotaBytes: Number(vault.quota_bytes),
        }
      }),
      maxVaults: MAX_VAULTS,
      registrationEnabled: REGISTRATION_ENABLED,
    },
    200,
    request,
  )
}

async function deleteVaultForAdmin(
  request: Request,
  vaultId: string,
): Promise<Response> {
  if (request.headers.get('X-Confirm-Vault-Id') !== vaultId) {
    return text('Repeat the exact vault id in X-Confirm-Vault-Id', 409, request)
  }
  const existing = db.query('SELECT id FROM vaults WHERE id = ?').get(vaultId) as Row | null
  if (!existing) return text('Vault not found', 404, request)

  db.transaction(() => {
    db.query('DELETE FROM changes WHERE vault_id = ?').run(vaultId)
    db.query('DELETE FROM revisions WHERE vault_id = ?').run(vaultId)
    db.query('DELETE FROM objects WHERE vault_id = ?').run(vaultId)
    db.query('DELETE FROM pairings WHERE vault_id = ?').run(vaultId)
    db.query('DELETE FROM devices WHERE vault_id = ?').run(vaultId)
    db.query('DELETE FROM vaults WHERE id = ?').run(vaultId)
  })()
  await rm(join(DATA_DIR, 'objects', vaultId), { recursive: true, force: true }).catch(error => {
    console.warn('[sync-server] deleted vault left orphaned object files', { vaultId, error })
  })
  return new Response(null, { status: 204, headers: responseHeaders(request) })
}

async function route(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'v1') return text('Not found', 404, request)
  if (parts[1] === 'health' && request.method === 'GET') return json({ ok: true }, 200, request)
  if (parts[1] === 'time' && request.method === 'GET') return json({ serverTime: now() }, 200, request)
  if (parts[1] === 'admin') {
    if (!ADMIN_TOKEN) return text('Server administration is not configured', 503, request)
    if (!authenticateAdmin(request)) return text('Unauthorized', 401, request)
    if (parts[2] === 'vaults' && parts.length === 3 && request.method === 'GET') {
      return listVaultsForAdmin(request)
    }
    if (parts[2] === 'vaults' && parts[3] && request.method === 'DELETE') {
      return deleteVaultForAdmin(request, validateId(parts[3], 'vault id'))
    }
    return text('Not found', 404, request)
  }
  if (parts[1] === 'vaults' && parts.length === 2 && request.method === 'POST') {
    return createVault(request)
  }

  const vaultId = validateId(parts[2], 'vault id')
  if (parts[1] !== 'vaults') return text('Not found', 404, request)
  if (parts[3] === 'pairings' && parts[4] && parts[5] === 'claim' && request.method === 'POST') {
    return claimPairing(request, vaultId, validateId(parts[4], 'pairing id'))
  }

  const device = authenticate(request, vaultId)
  if (!device) return text('Unauthorized', 401, request)
  const admission = admitDeviceRequest(device)
  if (!admission.allowed) {
    return limited('This device is sending too many sync requests', admission.retryAfter, request)
  }
  if (parts[3] === 'pairings' && parts.length === 4 && request.method === 'POST') {
    return createPairing(request, vaultId, device)
  }
  if (parts[3] === 'changes' && request.method === 'GET') {
    return listChanges(request, vaultId, Math.max(0, Number(url.searchParams.get('after') || 0)))
  }
  if (parts[3] === 'devices' && parts.length === 4 && request.method === 'GET') {
    return listDevices(request, vaultId, device)
  }
  if (parts[3] === 'devices' && parts[4] && request.method === 'DELETE') {
    return revokeDevice(request, vaultId, validateId(parts[4], 'device id'), device)
  }
  if (parts[3] === 'objects' && parts[4] && parts[5]) {
    const kind = parts[4]
    if (kind !== 'document' && kind !== 'asset') throw new Error('Invalid object kind')
    const objectId = validateId(parts[5], 'object id')
    if (request.method === 'PUT') return putObject(request, vaultId, kind, objectId, device)
    if (request.method === 'GET') {
      return getObject(request, vaultId, kind, objectId, url.searchParams.get('revision'))
    }
  }
  return text('Not found', 404, request)
}

expirePairings()
expireDeviceRequestEvents()
removePhantomAssetTombstones()
compactChangeFeed()
await removeOrphanObjectFiles()

Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  idleTimeout: 30,
  async fetch(request) {
    try {
      const origin = request.headers.get('Origin')
      if (origin && !ALLOWED_ORIGINS.has(origin)) return text('Origin not allowed', 403, request)
      return await route(request)
    } catch (error) {
      console.error('[sync-server]', error)
      return text(error instanceof Error ? error.message : 'Internal error', 400, request)
    }
  },
})

void garbageCollectDeletedDocuments().catch(error =>
  console.error('[sync-server] garbage collection failed', error),
)
setInterval(
  () =>
    void garbageCollectDeletedDocuments().catch(error =>
      console.error('[sync-server] garbage collection failed', error),
    ),
  6 * 60 * 60 * 1000,
)

setInterval(expirePairings, 60 * 60 * 1000)
setInterval(expireDeviceRequestEvents, 60 * 60 * 1000)

console.log(`Encrypted sync API listening on :${PORT}`)
