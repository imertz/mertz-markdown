import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('debounced callback durability', () => {
  it('keeps failed work pending and retries it', async () => {
    vi.useFakeTimers()
    const callback = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined)
    const view = renderHook(() => useDebouncedCallback(callback, 100))

    act(() => view.result.current.schedule('latest draft'))
    await expect(
      act(async () => view.result.current.flush()),
    ).rejects.toThrow('storage unavailable')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenLastCalledWith('latest draft')
    view.unmount()
  })
})
