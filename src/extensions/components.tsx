import type { Editor } from '@tiptap/core'
import type { ReactNode } from 'react'
import { extensions } from './registry'
import type { ExtensionHost } from './context'
import type { DocumentPanelProps, MertzExtension } from './types'

interface ExtensionDocumentActionsProps {
  host: ExtensionHost
  surface: 'header' | 'menu'
  disabled: boolean
  openPanel: (extensionId: string) => void
  beforeOpen?: () => void
}

export function ExtensionDocumentActions({
  host,
  surface,
  disabled,
  openPanel,
  beforeOpen,
}: ExtensionDocumentActionsProps) {
  return host.enabled.flatMap(extension =>
    [...(extension.documentActions ?? [])]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map(action => (
        <action.Component
          key={`${extension.id}:${action.id}`}
          surface={surface}
          disabled={disabled}
          openPanel={() => {
            beforeOpen?.()
            openPanel(extension.id)
          }}
        />
      )),
  )
}

interface ExtensionsDialogProps {
  host: ExtensionHost
  close: () => void
}

export function ExtensionsDialog({ host, close }: ExtensionsDialogProps) {
  return (
    <div className="extension-panel-backdrop" role="presentation">
      <section
        className="extensions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extensions-dialog-title"
      >
        <header className="publication-panel__header">
          <div>
            <p className="publication-panel__eyebrow">Application</p>
            <h2 id="extensions-dialog-title">Extensions</h2>
          </div>
          <button type="button" onClick={close}>
            Close
          </button>
        </header>
        {extensions.map(extension => {
          const record = host.settings.get(extension.id)
          if (!record) return null
          const SettingsPanel = extension.SettingsPanel
          return (
            <article className="extension-settings" key={extension.id}>
              <header>
                <div>
                  <h3>{extension.name}</h3>
                  <p>Version {extension.version}</p>
                </div>
                <label className="publication-panel__toggle">
                  <input
                    type="checkbox"
                    checked={record.enabled}
                    onChange={event =>
                      void host.setEnabled(extension.id, event.target.checked)
                    }
                  />
                  Enabled
                </label>
              </header>
              {record.enabled && SettingsPanel ? (
                <SettingsPanel
                  settings={record as never}
                  updateSettings={data =>
                    host.updateSettings(extension.id, data)
                  }
                />
              ) : null}
            </article>
          )
        })}
      </section>
    </div>
  )
}

interface ExtensionDocumentPanelProps {
  extensionId: string | null
  host: ExtensionHost
  documentId: string | null
  editor: Editor | null
  flushPendingWrites: () => Promise<void>
  close: () => void
  notify: (message: string) => void
}

export function ExtensionDocumentPanel({
  extensionId,
  host,
  documentId,
  editor,
  flushPendingWrites,
  close,
  notify,
}: ExtensionDocumentPanelProps): ReactNode {
  if (!extensionId || !documentId || !editor) return null
  const extension = host.enabled.find(candidate => candidate.id === extensionId)
  const settings = host.settings.get(extensionId)
  const Panel = extension?.DocumentPanel
  if (!extension || !settings || !Panel) return null

  const props: DocumentPanelProps<unknown> = {
    documentId,
    editor,
    settings,
    updateSettings: data => host.updateSettings(extensionId, data),
    flushPendingWrites,
    close,
    notify,
  }
  const UntypedPanel = Panel as MertzExtension<unknown>['DocumentPanel']
  return UntypedPanel ? <UntypedPanel {...props} /> : null
}
