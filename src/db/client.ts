import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, DB_VERSION, type MertzDB } from './schema'

/** Fired when another tab needs to upgrade the schema and we had to let go. */
export const DB_OUTDATED_EVENT = 'mertz:db-outdated'

let dbPromise: Promise<IDBPDatabase<MertzDB>> | null = null

export function getDB(): Promise<IDBPDatabase<MertzDB>> {
  dbPromise ??= openDB<MertzDB>(DB_NAME, DB_VERSION, {
    /**
     * Deliberately falls through: a browser sitting at v1 upgrading to v3 must
     * run 1 -> 2 -> 3 in order. `noFallthroughCasesInSwitch` is off in
     * tsconfig.app.json for exactly this function.
     */
    upgrade(db, oldVersion) {
      switch (oldVersion) {
        case 0: {
          const documents = db.createObjectStore('documents', { keyPath: 'id' })
          documents.createIndex('by-updatedAt', 'updatedAt')

          const threads = db.createObjectStore('threads', { keyPath: 'id' })
          threads.createIndex('by-docId', 'docId')
          threads.createIndex('by-doc-status', ['docId', 'status'])

          const comments = db.createObjectStore('comments', { keyPath: 'id' })
          comments.createIndex('by-threadId', 'threadId')
          comments.createIndex('by-docId', 'docId')
        }
        case 1: {
          const snapshots = db.createObjectStore('snapshots', {
            keyPath: 'id',
          })
          // by-docId serves the cascade delete; the compound index serves
          // listing and pruning, both of which want them in time order.
          snapshots.createIndex('by-docId', 'docId')
          snapshots.createIndex('by-doc-createdAt', ['docId', 'createdAt'])
        }
        case 2: {
          const assets = db.createObjectStore('assets', { keyPath: 'id' })
          assets.createIndex('by-docId', 'docId')
        }
        // case 3: … future migrations go here, with no `break` above.
      }
    },

    blocked() {
      console.warn('[db] upgrade blocked by another open tab')
    },

    /** Another tab wants to upgrade — release our handle so it can proceed. */
    blocking() {
      void dbPromise?.then(db => {
        db.close()
      })
      dbPromise = null
      window.dispatchEvent(new CustomEvent(DB_OUTDATED_EVENT))
    },

    /** The browser killed the connection; drop the cache so we reopen lazily. */
    terminated() {
      dbPromise = null
    },
  })

  return dbPromise
}

/**
 * Close the cached connection and forget it. Required before deleting the
 * database (an open handle makes `deleteDatabase` block indefinitely), which is
 * how tests get a clean slate between cases.
 */
export async function closeDB(): Promise<void> {
  const pending = dbPromise
  dbPromise = null
  if (!pending) return
  const db = await pending
  db.close()
}
