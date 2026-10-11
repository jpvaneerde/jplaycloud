import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

// Locally the card scanner lives under /scanner (on the server it gets its own host: scanner.jplay.cloud).
const scannerDevRoute: Plugin = {
  name: 'jplay-scanner-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/scanner(\/|$|\?)/i.test(req.url)) req.url = '/scan.html'
      next()
    })
  },
}

// Spotify only accepts registered redirect URIs: http://127.0.0.1:5173/callback locally.
export default defineConfig({
  plugins: [svelte(), scannerDevRoute],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        scan: resolve(__dirname, 'scan.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The API server: npm run dev:server
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
})
