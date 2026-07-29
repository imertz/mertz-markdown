import { closeDB } from '../db/client'
import { DB_NAME } from '../db/schema'
import { Blob as NodeBlob } from 'node:buffer'
import type {
  AssetRecord,
  CommentRecord,
  DocumentRecord,
  ThreadRecord,
  TextQuoteSelector,
} from '../types'

/**
 * Drop the whole database so each test starts from a real `upgrade()` run.
 * The cached connection has to be closed first or `deleteDatabase` blocks.
 */
export async function resetDatabase(): Promise<void> {
  await closeDB()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      resolve()
    }
    request.onerror = () => {
      reject(request.error)
    }
    // Nothing else should hold a handle in a test, but never hang if it does.
    request.onblocked = () => {
      resolve()
    }
  })
}

let seq = 0
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`

export function makeDocument(
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  const now = Date.now()
  return {
    id: nextId('doc'),
    title: 'Untitled',
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    markdown: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function makeAsset(
  docId: string,
  overrides: Partial<AssetRecord> = {},
): AssetRecord {
  const id = nextId('asset')
  return {
    id,
    docId,
    blob: new NodeBlob(['image bytes'], { type: 'image/png' }) as unknown as Blob,
    mimeType: 'image/png',
    originalName: 'diagram.png',
    storageName: `${id}.png`,
    size: 11,
    createdAt: Date.now(),
    ...overrides,
  }
}

export function makeSelector(
  overrides: Partial<TextQuoteSelector> = {},
): TextQuoteSelector {
  return { exact: 'quoted text', prefix: '', suffix: '', ...overrides }
}

export function makeThread(
  docId: string,
  overrides: Partial<ThreadRecord> = {},
): ThreadRecord {
  const now = Date.now()
  return {
    id: nextId('thread'),
    docId,
    status: 'open',
    selector: makeSelector(),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    orphanedAt: null,
    ...overrides,
  }
}

export function makeComment(
  threadId: string,
  docId: string,
  overrides: Partial<CommentRecord> = {},
): CommentRecord {
  const now = Date.now()
  return {
    id: nextId('comment'),
    threadId,
    docId,
    body: 'Looks good to me.',
    author: 'You',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
