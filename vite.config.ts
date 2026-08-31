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
        background_color: '#f7f6f4',
        theme_color: '#f7f6f4',
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
        /*
         * Mermaid is the one dependency big enough that precaching it would
         * change what installing this app costs — several times the size of
         * the editor, for a feature most documents never use. So its chunks
         * are left out of the precache and picked up by the runtime rule
         * below instead: nothing is downloaded until a document with a
         * diagram in it is opened, and from that moment on it is offline like
         * everything else.
         *
         * The path is not incidental — see chunkFileNames in `build` below,
         * which is what puts every mermaid chunk under this one directory so
         * that a glob can name them at all.
         */
        // The first entry is workbox's own default, which naming this
        // option at all would otherwise replace.
        globIgnores: ['**/node_modules/**/*', 'assets/mermaid/**'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/mermaid\//,
            // The filenames are content-hashed, so a cached chunk can never be
            // stale: a changed build is a changed URL.
            handler: 'CacheFirst',
            options: {
              cacheName: 'mermaid',
              expiration: { maxEntries: 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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

  build: {
    rollupOptions: {
      output: {
        /*
         * Give mermaid and everything it drags in a directory of its own.
         *
         * Not cosmetic: the service worker config above has to be able to name
         * these chunks to keep them out of the precache, and mermaid splits
         * itself into thirty or so of them — one per diagram type, each loaded
         * on demand by mermaid itself under a name we do not choose. A glob
         * over a directory is the only stable handle on that set.
         *
         * The list is mermaid's own `dependencies`, plus the d3 and cytoscape
         * families it pulls in by prefix. If a future version adds a package
         * this misses, the cost is that one chunk joining the precache — the
         * app is correct either way, just heavier to install, which is the
         * only thing this whole arrangement is buying.
         */
        chunkFileNames(chunk) {
          const packages = [
            'mermaid',
            '@mermaid-js/',
            '@braintree/sanitize-url',
            '@iconify/',
            '@upsetjs/',
            'cytoscape',
            'd3',
            'dagre-d3-es',
            'dayjs',
            'dompurify',
            'es-toolkit',
            'fastdom',
            'katex',
            'khroma',
            'langium',
            'chevrotain',
            'roughjs',
            'stylis',
            'ts-dedent',
            'uuid',
          ]

          const diagram = chunk.moduleIds?.some(id => {
            const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(
              id.replace(/\\/g, '/'),
            )
            const name = match?.[1]
            if (!name) return false
            return packages.some(
              entry =>
                name === entry ||
                name.startsWith(entry) ||
                // The d3 and cytoscape families ship a package per module.
                name.startsWith(`${entry}-`),
            )
          })

          return diagram
            ? 'assets/mermaid/[name]-[hash].js'
            : 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
