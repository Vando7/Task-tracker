import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { changePasswordSchema, updateProfileSchema } from '@task-tracker/shared'
import type { FastifyInstance } from 'fastify'
import { requireUser, requireVerifiedUser } from '../auth/middleware'
import { prisma } from '../db'
import { paths } from '../env'
import { badRequest } from '../lib/errors'
import { parseOrThrow } from '../lib/validate'
import { changePassword } from '../services/auth'
import { serializeSelfUser } from '../services/serialize'
import { listWorkspaces } from '../services/workspaces'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])

export async function meRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything the client needs to boot.
   *
   * `workspaces` may be empty, and that is a normal state. The legacy app
   * auto-created a workspace on every login specifically to avoid facing it,
   * which is why a cleared session or a revoked membership raised on the index
   * view.
   */
  app.get('/', async (request) => {
    const user = requireUser(request)
    return {
      user: serializeSelfUser(user),
      workspaces: user.emailVerifiedAt ? await listWorkspaces(user) : [],
    }
  })

  app.patch('/', async (request) => {
    const user = requireVerifiedUser(request)
    const input = parseOrThrow(updateProfileSchema, request.body)

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: input,
      select: {
        id: true,
        name: true,
        email: true,
        avatarPath: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    })

    return serializeSelfUser(updated)
  })

  app.post('/password', async (request) => {
    const user = requireVerifiedUser(request)
    const input = parseOrThrow(changePasswordSchema, request.body)
    await changePassword(user.id, input.currentPassword, input.newPassword)
    return { ok: true }
  })

  /**
   * Avatar upload. The Google profile-picture import is gone with OAuth; a user
   * without an upload gets an initials avatar on the client, so nobody ever
   * looks broken.
   */
  app.post('/avatar', async (request) => {
    const user = requireVerifiedUser(request)

    const file = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } })
    if (!file) throw badRequest('No file uploaded')

    const extension = ALLOWED_AVATAR_TYPES.get(file.mimetype)
    if (!extension) throw badRequest('Avatar must be a PNG, JPEG or WebP image')

    const buffer = await file.toBuffer()
    if (buffer.byteLength > MAX_AVATAR_BYTES) {
      throw badRequest('Avatar must be 2 MB or smaller')
    }

    // A generated name, never the client's: an uploaded filename is attacker
    // controlled and has no business reaching the filesystem.
    const filename = `${randomUUID()}${extension}`
    await fs.mkdir(paths.uploadDir, { recursive: true })
    await fs.writeFile(path.join(paths.uploadDir, filename), buffer)

    const previous = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarPath: true },
    })

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarPath: `/uploads/${filename}` },
      select: {
        id: true,
        name: true,
        email: true,
        avatarPath: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    })

    // Best-effort cleanup of the old file; a leftover is harmless, a failed
    // request is not.
    const oldName = previous?.avatarPath?.replace('/uploads/', '')
    if (oldName && /^[\w.-]+$/.test(oldName)) {
      await fs.rm(path.join(paths.uploadDir, oldName), { force: true }).catch(() => {})
    }

    return serializeSelfUser(updated)
  })
}
