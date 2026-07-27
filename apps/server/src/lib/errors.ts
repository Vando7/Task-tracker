/**
 * The only error type route handlers should throw.
 *
 * Note the deliberate choice to prefer 404 over 403 for anything belonging to
 * another workspace. The legacy `room()` and `floor()` views returned the real
 * page for any id, leaking names and emoji to any logged-in user (Part 2,
 * problem 3). Answering "not found" for something that exists but isn't yours
 * leaks nothing.
 */
export class HttpError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly fields?: Record<string, string[]>

  constructor(
    statusCode: number,
    message: string,
    code: string,
    fields?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    if (fields) this.fields = fields
  }
}

export const badRequest = (message: string, fields?: Record<string, string[]>): HttpError =>
  new HttpError(400, message, 'bad_request', fields)

export const unauthorized = (message = 'Not signed in'): HttpError =>
  new HttpError(401, message, 'unauthorized')

export const forbidden = (message = 'Not allowed'): HttpError =>
  new HttpError(403, message, 'forbidden')

export const notFound = (message = 'Not found'): HttpError =>
  new HttpError(404, message, 'not_found')

export const conflict = (message: string): HttpError => new HttpError(409, message, 'conflict')

export const unprocessable = (message: string, fields?: Record<string, string[]>): HttpError =>
  new HttpError(422, message, 'unprocessable', fields)
