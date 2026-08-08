import { useState } from 'react'
import { BlogApiClient } from '../api'
import type { BlogExtensionSettings } from '../state'
import type { ExtensionSettingsPanelProps } from '../../types'

function deviceLabel(): string {
  const platform = navigator.platform || 'Computer'
  const browser = navigator.userAgent.includes('Firefox')
    ? 'Firefox'
    : navigator.userAgent.includes('Edg/')
      ? 'Edge'
      : navigator.userAgent.includes('Chrome/')
        ? 'Chrome'
        : navigator.userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser'
  return `${browser} on ${platform}`
}

export function BlogSettings({
  settings,
  updateSettings,
}: ExtensionSettingsPanelProps<BlogExtensionSettings>) {
  const [serverUrl, setServerUrl] = useState(
    settings.data.connection?.serverUrl ?? '',
  )
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (settings.data.connection) {
    const disconnect = async () => {
      setBusy(true)
      setError(null)
      try {
        await new BlogApiClient(settings.data.connection!).disconnect()
        await updateSettings({ connection: null })
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'This publishing device could not be revoked',
        )
      } finally {
        setBusy(false)
      }
    }
    return (
      <div className="extension-settings__body">
        <dl className="extension-settings__facts">
          <div>
            <dt>Site</dt>
            <dd>{settings.data.connection.siteName}</dd>
          </div>
          <div>
            <dt>Server</dt>
            <dd>{settings.data.connection.serverUrl}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="extension-settings__secondary"
          disabled={busy}
          onClick={() => void disconnect()}
        >
          {busy ? 'Disconnecting…' : 'Disconnect this browser'}
        </button>
        {error ? <p className="extension-settings__error">{error}</p> : null}
      </div>
    )
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const connection = await BlogApiClient.claim(
        serverUrl.trim(),
        code.trim().toUpperCase(),
        deviceLabel(),
      )
      await updateSettings({ connection })
      setCode('')
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The server could not connect',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="extension-settings__body">
      <label>
        <span>Publishing server</span>
        <input
          type="url"
          inputMode="url"
          placeholder="https://publish.example.com"
          value={serverUrl}
          onChange={event => setServerUrl(event.target.value)}
        />
      </label>
      <label>
        <span>Single-use pairing code</span>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD-EFGH"
          value={code}
          onChange={event => setCode(event.target.value)}
        />
      </label>
      {error ? <p className="extension-settings__error">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !serverUrl.trim() || !code.trim()}
        onClick={() => void connect()}
      >
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}
