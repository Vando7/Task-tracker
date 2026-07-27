import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Reaching the dev server from another machine.
 *
 * `EXPOSE=1 pnpm dev` (or `EXPOSE=1 ./scripts/server.sh start`) binds this server
 * to every interface. The API deliberately stays on loopback: the browser only
 * ever talks to Vite, which proxies `/api` onward server-side, so exposing one
 * port is enough and port 3001 need not be reachable at all.
 *
 * Off by default. Binding a dev server to a network is a decision, not a default
 * — in development the session cookie is not `secure`, `SESSION_SECRET` falls
 * back to a known value, and the seeded accounts have a published password.
 */
const expose = process.env.EXPOSE === '1'

const webPort = Number(process.env.WEB_PORT ?? 5173)
const apiPort = Number(process.env.PORT ?? 3001)

/**
 * Vite refuses requests carrying a Host header it does not recognise, which is
 * what stops a hostile page from using DNS rebinding to reach a dev server.
 * Exposing on purpose means opting out of that, so it is scoped: set
 * `ALLOWED_HOSTS` to a comma-separated list to keep the check meaningful, and
 * only fall back to "anything" when the intent is already explicit.
 */
const allowedFromEnv = process.env.ALLOWED_HOSTS?.split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: expose ? true : 'localhost',
    port: webPort,
    // Fail loudly rather than silently sliding to the next free port, which would
    // put the app somewhere the process manager isn't looking.
    strictPort: true,
    ...(allowedFromEnv && allowedFromEnv.length > 0
      ? { allowedHosts: allowedFromEnv }
      : expose
        ? { allowedHosts: true as const }
        : {}),
    proxy: {
      // Same-origin in development, so the session cookie behaves exactly as it
      // will in production and there is no CORS story to get wrong.
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
        // SSE must stream, not buffer.
        ws: false,
      },
      '/uploads': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
