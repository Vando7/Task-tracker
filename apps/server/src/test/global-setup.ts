import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Build a fresh test database once per run.
 *
 * `migrate deploy` rather than `db push`, so the tests exercise the same
 * migration files that production will apply.
 */
export async function setup(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const serverDir = path.resolve(here, '../..')
  const repoRoot = path.resolve(serverDir, '../..')
  const dbFile = path.join(repoRoot, 'data', 'test.db')

  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbFile}${suffix}`, { force: true })
  }

  execFileSync(path.join(serverDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: 'file:data/test.db' },
    stdio: 'pipe',
  })
}
