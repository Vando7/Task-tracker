import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration.
 *
 * The database path is resolved to an absolute path from the repository root so
 * that `data/app.db` means the same file no matter which directory a command is
 * run from. Prisma resolves relative SQLite URLs against the schema file, which
 * would otherwise make the path in `.env` read as `../../../data/app.db`.
 */
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(serverDir, '../..')

const fromEnv = process.env['DATABASE_URL']?.replace(/^file:/, '')
const dbPath = path.resolve(repoRoot, fromEnv ?? 'data/app.db')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: `file:${dbPath}`,
  },
})
