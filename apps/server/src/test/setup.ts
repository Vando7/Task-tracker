import { afterAll, beforeEach } from 'vitest'
import { closeDatabase, initDatabase, prisma } from '../db'

await initDatabase()

/**
 * Truncate between tests rather than rolling back a transaction: several code
 * paths under test open their own transaction, and nesting those inside an outer
 * one would test something other than what runs in production.
 */
beforeEach(async () => {
  await prisma.notifyLog.deleteMany()
  await prisma.pushSubscription.deleteMany()
  await prisma.notifyPreference.deleteMany()
  await prisma.taskCompletion.deleteMany()
  await prisma.taskAssignee.deleteMany()
  await prisma.taskRoom.deleteMany()
  await prisma.task.deleteMany()
  await prisma.room.deleteMany()
  await prisma.floor.deleteMany()
  await prisma.member.deleteMany()
  await prisma.workspace.deleteMany()
  await prisma.emailToken.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
})

afterAll(closeDatabase)
