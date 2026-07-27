import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development, so the session cookie behaves exactly as it
      // will in production and there is no CORS story to get wrong.
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
        // SSE must stream, not buffer.
        ws: false,
      },
      '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
