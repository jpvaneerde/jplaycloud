import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Spotify only accepts registered redirect URIs: http://127.0.0.1:5173/callback locally.
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The API server: npm run dev:server
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
})
