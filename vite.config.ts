import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      /*
       * 'prompt', not 'autoUpdate'. autoUpdate calls skipWaiting() and reloads
       * as soon as a new service worker appears — which in an editor means
       * losing whatever was typed since the last autosave. The prompt lets us
       * flush pending state first (see usePwaUpdate).
       */
      registerType: 'prompt',
      injectRegister: 'auto',
      pwaAssets: { config: true },

      manifest: {
        id: '/',
        name: "Yiannis Mertzanis' Markdown",
        // The launcher label, so it has to survive truncation: YMM is the
        // monogram in the icon (Y + double M), which is what the full name
        // spells out.
        short_name: 'YMM',
        description:
          'Offline markdown editor with inline comments. Exports clean GFM.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        // Splash screen only — the live address bar is driven by the
        // theme-color meta in index.html, which useTheme swaps per theme.
        // Both sides use the app's own page colour so the launch is seamless.
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        categories: ['productivity', 'utilities'],
        // Enables "Open with Yiannis Mertzanis' Markdown" from the OS file
        // manager — that string is the manifest `name` above.
        file_handlers: [
          {
            action: '/',
            accept: { 'text/markdown': ['.md', '.markdown'] },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,txt}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Single-page app: any navigation falls back to the precached shell,
        // which is what makes a cold offline start work.
        navigateFallback: 'index.html',
      },

      /*
       * suppressWarnings: in dev the SW is generated into dev-dist, which only
       * ever holds sw.js and workbox-*.js — both globIgnored — so the production
       * globPatterns below match nothing and workbox-build warns every restart.
       * The flag swaps in a dev-only glob; the production precache is unaffected.
       */
      devOptions: { enabled: true, type: 'module', suppressWarnings: true },
    }),
  ],
})
