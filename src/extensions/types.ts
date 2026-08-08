import type { AnyExtension, Editor } from '@tiptap/core'
import type { ComponentType } from 'react'
import type { ExtensionSettingsRecord } from '../types'

export interface ExtensionDocumentContext {
  documentId: string
  editor: Editor
  signal: AbortSignal
}

export interface ExtensionSettingsPanelProps<T = unknown> {
  settings: ExtensionSettingsRecord & { data: T }
  updateSettings: (data: T) => Promise<void>
}

export interface DocumentActionProps {
  surface: 'header' | 'menu'
  openPanel: () => void
  disabled: boolean
}

export interface DocumentPanelProps<T = unknown> {
  documentId: string
  editor: Editor
  settings: ExtensionSettingsRecord & { data: T }
  updateSettings: (data: T) => Promise<void>
  flushPendingWrites: () => Promise<void>
  close: () => void
  notify: (message: string) => void
}

export interface DocumentAction {
  id: string
  order?: number
  Component: ComponentType<DocumentActionProps>
}

export interface CommandContribution {
  id: string
  label: string
  keywords?: readonly string[]
  run: () => void
}

/** A statically imported application extension; never remote executable code. */
export interface MertzExtension<TSettings = unknown> {
  id: string
  name: string
  version: number
  defaultEnabled?: boolean
  defaultSettings: TSettings
  editorExtensions?: readonly AnyExtension[]
  documentActions?: readonly DocumentAction[]
  commands?: readonly CommandContribution[]
  SettingsPanel?: ComponentType<ExtensionSettingsPanelProps<TSettings>>
  DocumentPanel?: ComponentType<DocumentPanelProps<TSettings>>
  onDocumentLoaded?: (
    context: ExtensionDocumentContext,
  ) => void | Promise<void>
}

export type AnyMertzExtension = MertzExtension<never>
