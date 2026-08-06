import { useCallback, useEffect, useRef } from 'react'

export interface DebouncedCallback<A extends unknown[]> {
  /** Queue a call, resetting the timer. */
  schedule: (...args: A) => void
  /** Run any queued call immediately. Safe to call when nothing is pending. */
  flush: () => Promise<void>
  /** Drop any queued call without running it. */
  cancel: () => void
}

/**
 * Debounce that keeps a `flush` handle.
 *
 * Autosave needs it for the cases where waiting out the delay is not an
 * option: a service-worker update about to reload the page, or the tab being
 * hidden. Without flush, whatever was typed in the last 800 ms is simply lost.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void | Promise<void>,
  delay: number,
): DebouncedCallback<A> {
  const callbackRef = useRef(callback)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgs = useRef<A | null>(null)
  const mounted = useRef(true)
  const flushRef = useRef<() => Promise<void>>(async () => undefined)

  // Keep the latest closure without resubscribing anything.
  useEffect(() => {
    callbackRef.current = callback
  })

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const flush = useCallback(async () => {
    clear()
    const args = pendingArgs.current
    if (!args) return
    try {
      await callbackRef.current(...args)
      if (pendingArgs.current === args) pendingArgs.current = null
    } catch (error) {
      // A failed IndexedDB write is still pending work. Keep the exact latest
      // arguments and retry after the normal debounce delay; callers that
      // explicitly flush also receive the error and can abort destructive work.
      if (mounted.current && pendingArgs.current === args) {
        timer.current = setTimeout(() => {
          void flushRef.current().catch(() => undefined)
        }, delay)
      }
      throw error
    }
  }, [clear, delay])
  flushRef.current = flush

  const cancel = useCallback(() => {
    clear()
    pendingArgs.current = null
  }, [clear])

  const schedule = useCallback(
    (...args: A) => {
      pendingArgs.current = args
      clear()
      timer.current = setTimeout(() => {
        void flush().catch(() => undefined)
      }, delay)
    },
    [clear, delay, flush],
  )

  // Unmount must not silently discard a pending save.
  useEffect(
    () => {
      mounted.current = true
      return () => {
        mounted.current = false
        void flush().catch(() => undefined)
      }
    },
    [flush],
  )

  return { schedule, flush, cancel }
}
