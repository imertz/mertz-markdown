import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IMPORTED_IMAGE_FALLBACK_MIME,
  IMPORTED_IMAGE_MIME,
  IMPORTED_IMAGE_QUALITY,
  optimizeImportedImage,
} from '../images/optimize'
import {
  OPTIMIZED_IMAGE_BYTES,
  stubImageOptimizer,
} from './imageOptimizeHarness'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('imported image optimization', () => {
  it('converts a still image to WebP without enlarging its dimensions', async () => {
    const encoding = stubImageOptimizer({ width: 800, height: 600 })
    const source = new File(['png bytes'], 'Release chart.png', {
      type: 'image/png',
      lastModified: 123,
    })

    const optimized = await optimizeImportedImage(source)

    expect(optimized).not.toBe(source)
    expect(optimized.name).toBe('Release chart.webp')
    expect(optimized.type).toBe(IMPORTED_IMAGE_MIME)
    expect(optimized.lastModified).toBe(123)
    expect(await optimized.text()).toBe(OPTIMIZED_IMAGE_BYTES)
    expect(encoding.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      800,
      600,
    )
    expect(encoding.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      IMPORTED_IMAGE_MIME,
      IMPORTED_IMAGE_QUALITY,
    )
    expect(encoding.close).toHaveBeenCalledOnce()
  })

  it.each([
    { width: 4000, height: 2000, expectedWidth: 1920, expectedHeight: 960 },
    { width: 1200, height: 3000, expectedWidth: 768, expectedHeight: 1920 },
  ])(
    'contains a $width × $height image within 1920 px',
    async ({ width, height, expectedWidth, expectedHeight }) => {
      const encoding = stubImageOptimizer({ width, height })

      await optimizeImportedImage(
        new File(['jpeg bytes'], 'photo.jpg', { type: 'image/jpeg' }),
      )

      expect(encoding.drawImage).toHaveBeenCalledWith(
        expect.anything(),
        0,
        0,
        expectedWidth,
        expectedHeight,
      )
    },
  )

  it('does not re-encode a WebP that is already within the limit', async () => {
    const encoding = stubImageOptimizer({ width: 1600, height: 900 })
    const source = new File(['webp bytes'], 'photo.webp', {
      type: 'image/webp',
    })

    await expect(optimizeImportedImage(source)).resolves.toBe(source)
    expect(encoding.toBlob).not.toHaveBeenCalled()
    expect(encoding.close).toHaveBeenCalledOnce()
  })

  it('resizes an oversized WebP', async () => {
    const encoding = stubImageOptimizer({ width: 2400, height: 1200 })
    const source = new File(['webp bytes'], 'photo.webp', {
      type: 'image/webp',
    })

    const optimized = await optimizeImportedImage(source)

    expect(optimized).not.toBe(source)
    expect(encoding.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1920,
      960,
    )
  })

  it('normalizes an AVIF to WebP', async () => {
    stubImageOptimizer({ width: 1000, height: 1000 })
    const source = new File(['avif bytes'], 'illustration.avif', {
      type: 'image/avif',
    })

    const optimized = await optimizeImportedImage(source)

    expect(optimized.name).toBe('illustration.webp')
    expect(optimized.type).toBe(IMPORTED_IMAGE_MIME)
  })

  it('preserves GIF bytes and animation instead of drawing through canvas', async () => {
    const encoding = stubImageOptimizer({ width: 4000, height: 2000 })
    const source = new File(['animated gif bytes'], 'animation.gif', {
      type: 'image/gif',
    })

    await expect(optimizeImportedImage(source)).resolves.toBe(source)
    expect(encoding.createBitmap).toHaveBeenCalledOnce()
    expect(encoding.toBlob).not.toHaveBeenCalled()
  })

  it('falls back to PNG when the browser cannot encode WebP', async () => {
    const encoding = stubImageOptimizer()
    encoding.toBlob
      .mockImplementationOnce(callback =>
        callback(new Blob(['automatic PNG'], { type: 'image/png' })),
      )
      .mockImplementationOnce((callback, type) =>
        callback(new Blob(['PNG fallback'], { type })),
      )

    const optimized = await optimizeImportedImage(
      new File(['png bytes'], 'diagram.png', { type: 'image/png' }),
    )

    expect(optimized.name).toBe('diagram.png')
    expect(optimized.type).toBe(IMPORTED_IMAGE_FALLBACK_MIME)
    expect(await optimized.text()).toBe('PNG fallback')
    expect(encoding.toBlob).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      IMPORTED_IMAGE_FALLBACK_MIME,
      1,
    )
    expect(encoding.close).toHaveBeenCalledOnce()
  })

  it('rejects when WebP and PNG encoding both fail', async () => {
    const encoding = stubImageOptimizer()
    encoding.toBlob.mockImplementation(callback => callback(null))

    await expect(
      optimizeImportedImage(
        new File(['png bytes'], 'diagram.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('could not encode the imported image')
    expect(encoding.toBlob).toHaveBeenCalledTimes(2)
    expect(encoding.close).toHaveBeenCalledOnce()
  })
})
