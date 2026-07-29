// Installs a spec-compliant in-memory IndexedDB onto globalThis. happy-dom does
// not ship one, and the db layer is exercised directly in unit tests.
import 'fake-indexeddb/auto'
