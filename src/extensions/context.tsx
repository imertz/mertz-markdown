import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getExtensionSettings,
  putExtensionSettings,
} from './storage'
import type { ExtensionSettingsRecord } from '../types'
import { extensions } from './registry'
import type { ExtensionDocumentContext, MertzExtension } from './types'

export interface ExtensionHost {
  ready: boolean
  settings: ReadonlyMap<string, ExtensionSettingsRecord>
  enabled: readonly MertzExtension<unknown>[]
  setEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  updateSettings: <T>(extensionId: string, data: T) => Promise<void>
  documentLoaded: (context: Omit<ExtensionDocumentContext, 'signal'>) => void
}

export function useExtensionHost(): ExtensionHost {
  const [settings, setSettings] = useState<Map<string, ExtensionSettingsRecord>>(
    new Map(),
  )
  const [ready, setReady] = useState(false)
  const lifecycle = useRef<AbortController | null>(null)

  useEffect(() => {
    let current = true
    void Promise.all(
      extensions.map(async extension => {
        const stored = await getExtensionSettings(extension.id)
        return stored ?? {
          extensionId: extension.id,
          version: extension.version,
          enabled: extension.defaultEnabled ?? false,
          data: extension.defaultSettings,
          updatedAt: 0,
        }
      }),
    ).then(records => {
      if (!current) return
      setSettings(new Map(records.map(record => [record.extensionId, record])))
      setReady(true)
    })
    return () => {
      current = false
      lifecycle.current?.abort()
    }
  }, [])

  const persist = useCallback(async (record: ExtensionSettingsRecord) => {
    await putExtensionSettings(record)
    setSettings(previous => new Map(previous).set(record.extensionId, record))
  }, [])

  const setEnabled = useCallback(
    async (extensionId: string, enabled: boolean) => {
      const extension = extensions.find(candidate => candidate.id === extensionId)
      if (!extension) throw new Error(`Unknown extension: ${extensionId}`)
      const existing = settings.get(extensionId)
      await persist({
        extensionId,
        version: extension.version,
        enabled,
        data: existing?.data ?? extension.defaultSettings,
        updatedAt: Date.now(),
      })
    },
    [persist, settings],
  )

  const updateSettings = useCallback(
    async <T,>(extensionId: string, data: T) => {
      const extension = extensions.find(candidate => candidate.id === extensionId)
      if (!extension) throw new Error(`Unknown extension: ${extensionId}`)
      const existing = settings.get(extensionId)
      await persist({
        extensionId,
        version: extension.version,
        enabled: existing?.enabled ?? extension.defaultEnabled ?? false,
        data,
        updatedAt: Date.now(),
      })
    },
    [persist, settings],
  )

  const enabled = useMemo(
    () => extensions.filter(extension => settings.get(extension.id)?.enabled),
    [settings],
  )

  const documentLoaded = useCallback(
    (context: Omit<ExtensionDocumentContext, 'signal'>) => {
      lifecycle.current?.abort()
      const controller = new AbortController()
      lifecycle.current = controller
      for (const extension of enabled) {
        void Promise.resolve(
          extension.onDocumentLoaded?.({
            ...context,
            signal: controller.signal,
          }),
        ).catch(error => {
          if (!controller.signal.aborted) {
            console.error(`[extension:${extension.id}] document load failed`, error)
          }
        })
      }
    },
    [enabled],
  )

  return {
    ready,
    settings,
    enabled,
    setEnabled,
    updateSettings,
    documentLoaded,
  }
}
