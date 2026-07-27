/**
 * The API contract.
 *
 * This package is the *only* place an API shape is defined. The server validates
 * requests and responses against these schemas; the web client imports the
 * inferred types. If the two ever disagree about a field, the schema is right.
 */

export * from './constants'
export * from './schemas/auth'
export * from './schemas/comment'
export * from './schemas/common'
export * from './schemas/events'
export * from './schemas/layout'
export * from './schemas/notification'
export * from './schemas/session'
export * from './schemas/stats'
export * from './schemas/task'
export * from './schemas/user'
export * from './schemas/workspace'
