/**
 * The File Handling API, which TypeScript's DOM lib does not declare.
 *
 * The manifest in vite.config.ts already registers this app as a handler for
 * `text/markdown`; without a consumer the OS opens the app and drops the file
 * on the floor, so this is the other half of a promise already made.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/Window/launchQueue
 */
interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[]
  readonly targetURL?: string
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void
}

interface Window {
  readonly launchQueue?: LaunchQueue
}
