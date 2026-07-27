import fs from 'node:fs'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client'
import { isTest, paths } from './env'

/**
 * The Prisma client singleton.
 *
 * Prisma 7 has no query engine binary — it compiles queries and hands them to a
 * driver adapter — so better-sqlite3 is doing the actual talking. That is what
 * lets us set the pragmas below, which is the whole reason SQLite is a sane
 * choice for a multi-member household app.
 */

fs.mkdirSync(path.dirname(paths.databaseFile), { recursive: true })

const adapter = new PrismaBetterSqlite3({ url: `file:${paths.databaseFile}` })

export const prisma = new PrismaClient({
  adapter,
  log: isTest ? [] : ['warn', 'error'],
})

/**
 * Pragmas that have to be set per connection.
 *
 * - `journal_mode=WAL` lets readers and a writer coexist, which is what makes
 *   concurrent members workable on a single file.
 * - `foreign_keys=ON` is *off* by default in SQLite. Without it none of the
 *   `onDelete` behaviour in the schema actually happens.
 * - `busy_timeout` turns a lost write race into a short wait instead of an
 *   immediate SQLITE_BUSY error.
 */
export async function initDatabase(): Promise<void> {
  const journalMode = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
    'PRAGMA journal_mode = WAL',
  )
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000')
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL')

  const mode = journalMode[0]?.journal_mode
  if (mode && mode.toLowerCase() !== 'wal') {
    // Not fatal — an in-memory database reports "memory" — but worth surfacing.
    console.warn(`[db] journal_mode is "${mode}", expected "wal"`)
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect()
}
