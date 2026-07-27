import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.test.ts', 'packages/shared/src/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./apps/server/src/test/global-setup.ts'],
    setupFiles: ['./apps/server/src/test/setup.ts'],
    // A separate database file, so running tests can never touch dev data.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:data/test.db',
      SESSION_SECRET: 'test-only-session-secret-at-least-32-chars',
      MAIL_TRANSPORT: 'console',
    },
    // SQLite is one file with one writer; parallel suites would fight over it.
    fileParallelism: false,
    restoreMocks: true,
  },
})
