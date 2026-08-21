import { useState } from 'react'

interface PairingHandoffProps {
  link: string
  /** Spend the pairing in this browser tab after all. */
  onPairHere: () => void
  onDismiss: () => void
}

/**
 * Shown when a pairing link opens somewhere it probably was not meant to: an
 * iOS browser tab, on a device where the installed app is a separate browser
 * with its own storage and no way to receive a link. See pairingNeedsHandoff.
 *
 * The pairing is already out of the URL and out of the pending slot by the time
 * this renders, so nothing claims it while the user decides — which is the
 * point. A pairing is one-shot; spending it in the wrong browser is the failure
 * this exists to prevent.
 */
export function PairingHandoff({ link, onPairHere, onDismiss }: PairingHandoffProps) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div className="palette-backdrop">
      <div
        className="pairing-handoff"
        role="dialog"
        aria-modal="true"
        aria-label="Pairing link"
      >
        <h2 className="pairing-handoff__title">Pair the installed app?</h2>
        <p className="pairing-handoff__body">
          A scanned link always opens here in the browser, and the app installed on
          your Home Screen keeps its own separate storage — pairing here would not
          reach it, and the link only works once.
        </p>
        <ol className="pairing-handoff__steps">
          <li>Copy the pairing link.</li>
          <li>Open the app from your Home Screen.</li>
          <li>
            Tap <strong>Sync</strong>, then paste the link under{' '}
            <strong>Join a vault</strong>.
          </li>
        </ol>

        {/* Readable as well as copyable: clipboard writes can be refused, and a
            link nobody can see is a dead end. */}
        <input
          className="pairing-handoff__link"
          type="text"
          value={link}
          readOnly
          aria-label="Pairing link"
          onFocus={event => event.currentTarget.select()}
        />

        <div className="pairing-handoff__actions">
          <button type="button" className="btn--primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy pairing link'}
          </button>
          <button type="button" onClick={onPairHere}>
            Pair this browser instead
          </button>
          <button type="button" className="pairing-handoff__dismiss" onClick={onDismiss}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
