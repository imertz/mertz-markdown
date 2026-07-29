import { useEffect } from 'react'

interface UndoToastProps {
  message: string
  /** How long the offer stands. */
  timeoutMs?: number
  onUndo: () => void
  onDismiss: () => void
}

const DEFAULT_TIMEOUT_MS = 6000

/**
 * "Deleted X — Undo".
 *
 * The offer expires rather than lingering: the document is in the trash for a
 * month either way, so a toast that stayed put would only be covering the
 * status bar to repeat something the picker already says.
 */
export function UndoToast({
  message,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onUndo,
  onDismiss,
}: UndoToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, timeoutMs)
    return () => {
      clearTimeout(timer)
    }
    // Re-armed whenever the message changes, so a second delete gets its own
    // full window rather than inheriting the remains of the first one's.
  }, [message, timeoutMs, onDismiss])

  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  )
}
