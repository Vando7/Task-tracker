import { z } from 'zod'
import { selfUserSchema } from './user'
import { workspaceSchema } from './workspace'

/**
 * `GET /api/me` — everything the client needs to boot.
 *
 * `workspaces` may legitimately be empty. The legacy app auto-created a
 * workspace on every login to avoid ever facing that case, which is why a
 * cleared session or a revoked membership crashed the index view. Here an empty
 * list is a normal state that the UI handles with a create prompt.
 */
export const meSchema = z.object({
  user: selfUserSchema,
  workspaces: z.array(workspaceSchema),
})
export type Me = z.infer<typeof meSchema>
