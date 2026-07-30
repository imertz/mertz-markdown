import { vi } from 'vitest'

export const OPTIMIZED_IMAGE_BYTES = 'optimized webp bytes'

interface ImageOptimizerStubOptions {
  width?: number
  height?: number
}

export function stubImageOptimizer({
  width = 800,
  height = 600,
}: ImageOptimizerStubOptions = {}) {
  const close = vi.fn()
  const createBitmap = vi.fn(async () => ({ width, height, close }) as ImageBitmap)
  vi.stubGlobal('createImageBitmap', createBitmap)

  const drawImage = vi.fn()
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback, type) => {
      callback(new Blob([OPTIMIZED_IMAGE_BYTES], { type }))
    })

  return { close, createBitmap, drawImage, getContext, toBlob }
}
