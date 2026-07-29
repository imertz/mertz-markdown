import {
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config'

/**
 * Generates the PWA icon set from one square source.
 *
 * `pwa-source.svg` is the square, maskable-safe master: the monogram is scaled
 * to clear the 80% safe area and the background bleeds past the viewBox. The
 * `favicon.svg` linked from index.html is the same art with rounded corners,
 * and is *not* generated — the two are edited together.
 *
 * minimal2023Preset emits pwa-64x64.png, pwa-192x192.png, pwa-512x512.png,
 * maskable-icon-512x512.png, apple-touch-icon-180x180.png and favicon.ico,
 * and vite-plugin-pwa injects the matching <link> tags.
 *
 * Its *padding* defaults are overridden below, and that is the whole reason
 * this file is not one line. Upstream ships 0.05 for the plain icons and 0.3
 * for maskable and apple, matted onto white — sensible for a bare glyph that
 * needs a safe area drawn around it, wrong for ours, which is a full-bleed tile
 * with the safe area already in the artwork. Left alone it pads a second time,
 * and macOS shows the tile shrunk inside a white square.
 *
 * `padding: 0` is therefore only safe *because* pwa-source.svg carries its own
 * margin. Replace the art with a bare glyph and the padding has to come back,
 * or Android's circular mask will clip it.
 *
 * The background is the tile colour rather than white so that if the source
 * ever fails to cover the canvas the failure is an invisible seam instead of a
 * white ring. It duplicates --accent from src/styles/index.css the same way the
 * SVGs do — a build-time config cannot read a CSS token.
 */
const TILE = '#b3512f'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0,
      resizeOptions: { background: TILE },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0,
      resizeOptions: { background: TILE },
    },
  },
  images: ['public/pwa-source.svg'],
})
