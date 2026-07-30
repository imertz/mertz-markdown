import { useEffect, useState } from 'react'
import type { VaultSyncApi } from '../../hooks/useVaultSync'
import { useDismissable } from '../../hooks/useDismissable'
import { formatBinaryBytes } from '../../lib/time'

const STATUS_LABEL = {
  disabled: 'Local only',
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes queued',
  error: 'Sync problem',
} as const

/** Past this fraction the meter turns amber: the ceiling is close enough to hit. */
const METER_FULL = 0.9

interface Notice {
  text: string
  tone: 'ok' | 'error'
}

interface VaultMenuProps {
  sync: VaultSyncApi
}

export function VaultMenu({ sync }: VaultMenuProps) {
  const [open, setOpen] = useState(false)
  const [acceptedLoss, setAcceptedLoss] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pairingLink, setPairingLink] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const container = useDismissable<HTMLDivElement>(open, () => setOpen(false))
  const syncEnabled = sync.enabled
  const loadDevices = sync.loadDevices

  useEffect(() => {
    if (open && syncEnabled) void loadDevices().catch(() => undefined)
  }, [open, syncEnabled, loadDevices])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try {
      await task()
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'The sync request failed',
        tone: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const addComputer = () =>
    void run(async () => {
      const link = await sync.createPairingLink()
      const { default: QRCode } = await import('qrcode')
      setPairingLink(link)
      setQr(await QRCode.toDataURL(link, { width: 220, margin: 1 }))
    })

  const copyPairing = () =>
    void run(async () => {
      if (!pairingLink) return
      await navigator.clipboard.writeText(pairingLink)
      setNotice({ text: 'Pairing link copied. It expires in 10 minutes.', tone: 'ok' })
    })

  const usage = sync.usage
  const ratio =
    usage && usage.quotaBytes > 0 ? Math.min(1, usage.bytes / usage.quotaBytes) : null

  /*
   * Rendered in both the setup and the managed state. Before a vault exists
   * there is nothing on the server to measure, so the storage cell falls back
   * to the flat allowance — the figure is a promise then, a reading afterwards.
   */
  const allocation = (
    <dl className="vault-menu__allocation" aria-label="Vault allowance">
      <div>
        <dt>Storage</dt>
        <dd>
          {usage
            ? `${formatBinaryBytes(usage.bytes)} of ${formatBinaryBytes(usage.quotaBytes)}`
            : '500 MiB'}
          {ratio !== null ? (
            <div className="vault-menu__meter" data-full={ratio >= METER_FULL}>
              <span style={{ width: `${ratio > 0 ? Math.max(2, ratio * 100) : 0}%` }} />
            </div>
          ) : null}
        </dd>
      </div>
      <div>
        <dt>Identity</dt>
        <dd>Anonymous</dd>
      </div>
    </dl>
  )

  return (
    <div className="vault-menu" ref={container}>
      <button
        type="button"
        className="vault-menu__trigger"
        aria-expanded={open}
        title={STATUS_LABEL[sync.status]}
        onClick={() => setOpen(value => !value)}
      >
        <span className="vault-menu__mark" data-status={sync.status} aria-hidden="true" />
        Sync
      </button>

      {open ? (
        <div className="vault-menu__panel" role="dialog" aria-label="Encrypted sync">
          <header className="vault-menu__header">
            <h2 className="vault-menu__title">
              Encrypted vault
              <span className="vault-menu__status">{STATUS_LABEL[sync.status]}</span>
            </h2>
            {sync.enabled ? (
              <button type="button" disabled={busy} onClick={() => void run(sync.syncNow)}>
                Sync now
              </button>
            ) : null}
          </header>

          {!sync.enabled ? (
            <form
              className="vault-menu__setup"
              onSubmit={event => {
                event.preventDefault()
                if (!acceptedLoss) return
                void run(async () => {
                  await sync.enable()
                })
              }}
            >
              <p className="vault-menu__intro">
                Create a private vault for this library. The server stores encrypted data;
                your browsers keep the only key.
              </p>
              {allocation}
              <label className="vault-menu__warning">
                <input
                  type="checkbox"
                  checked={acceptedLoss}
                  onChange={event => setAcceptedLoss(event.target.checked)}
                />
                I understand there is no recovery key. If every paired browser is lost,
                the encrypted vault cannot be recovered.
              </label>
              <button
                type="submit"
                className="btn--primary"
                disabled={busy || !acceptedLoss}
              >
                {busy ? 'Creating vault…' : 'Create encrypted vault'}
              </button>
            </form>
          ) : (
            <>
              <div className="vault-menu__setup">{allocation}</div>

              <section className="vault-menu__section">
                <div className="vault-menu__section-heading">
                  <strong>Paired computers</strong>
                  <button type="button" disabled={busy} onClick={addComputer}>
                    Add computer
                  </button>
                </div>
                {sync.devices.length ? (
                  <ul className="vault-menu__devices">
                    {sync.devices.map(device => (
                      <li key={device.id}>
                        <span>
                          {device.label}
                          {device.current ? (
                            <small className="vault-menu__self">this computer</small>
                          ) : null}
                        </span>
                        {!device.current ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(() => sync.revokeDevice(device.id))}
                          >
                            Revoke
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="vault-menu__muted">Loading devices…</p>
                )}
              </section>

              {pairingLink ? (
                <section className="vault-menu__pairing">
                  <strong>Scan on the new computer</strong>
                  {qr ? <img src={qr} alt="One-time vault pairing QR code" /> : null}
                  <button type="button" onClick={copyPairing}>Copy one-time link</button>
                  <small>Expires in 10 minutes and works once.</small>
                </section>
              ) : null}

              <div className="vault-menu__footer">
                <button
                  type="button"
                  className="vault-menu__forget"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!window.confirm('Forget the vault key on this browser? Local documents remain.')) {
                        return
                      }
                      await sync.disableOnDevice()
                    })
                  }
                >
                  Forget sync on this browser
                </button>
              </div>
            </>
          )}

          {sync.error || notice ? (
            <p
              className="vault-menu__message"
              data-tone={notice?.tone ?? 'error'}
              role="status"
            >
              {notice?.text ?? sync.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
