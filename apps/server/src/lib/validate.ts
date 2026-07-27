import type { z } from 'zod'
import { badRequest } from './errors'

/**
 * Parse untrusted input against a shared schema, or fail with a 400 carrying
 * field-level detail.
 *
 * Every request body, query string and path param goes through here. That is the
 * whole answer to the legacy `update_task`, which `setattr`'d
 * `status`/`type`/`category` straight from the request body with no enum check
 * and no length check, because Django does not validate on `save()`.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  data: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const fields: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_'
    const existing = fields[key]
    if (existing) existing.push(issue.message)
    else fields[key] = [issue.message]
  }

  throw badRequest('Invalid request', fields)
}
