import type { ApiError } from '@task-tracker/shared'

/**
 * The only place `fetch` is called.
 *
 * Types come from `@task-tracker/shared`, so a route's response type is the same
 * object the server validated on the way out. There is no hand-built dict and no
 * second definition of any shape (Part 2, problem 22).
 */

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string[]>

  constructor(status: number, body: ApiError['error']) {
    super(body.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code ?? 'error'
    if (body.fields) this.fields = body.fields
  }

  /** First message for a given field, for inline form errors. */
  fieldError(name: string): string | undefined {
    return this.fields?.[name]?.[0]
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { method = 'GET', body, signal } = options

  const response = await fetch(path, {
    method,
    // The session cookie is httpOnly; the browser attaches it, we never read it.
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  })

  if (response.status === 204) return undefined as TResponse

  const text = await response.text()
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined

  if (!response.ok) {
    const asError = payload as ApiError | undefined
    throw new ApiRequestError(
      response.status,
      asError?.error ?? { message: response.statusText || 'Request failed' },
    )
  }

  return payload as TResponse
}

/** Multipart, for the avatar upload — no JSON content type. */
export async function apiUpload<TResponse>(path: string, file: File): Promise<TResponse> {
  const form = new FormData()
  form.append('file', file)

  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', body: form })
  const text = await response.text()
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined

  if (!response.ok) {
    const asError = payload as ApiError | undefined
    throw new ApiRequestError(
      response.status,
      asError?.error ?? { message: response.statusText || 'Upload failed' },
    )
  }

  return payload as TResponse
}

/** Build a query string, dropping empty values so URLs stay readable. */
export function query(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}
