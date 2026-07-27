import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Every environment variable, validated once at boot.
 *
 * A typo fails immediately with a readable message instead of surfacing as a
 * mystery at 3am. The legacy app had the opposite: a misspelled setting
 * (`CIALACCOUNT_AUTO_SIGNUP`) that silently never took effect (Part 2, 29).
 */

const srcDir = path.dirname(fileURLToPath(import.meta.url))
/** apps/server/src -> apps/server -> apps -> repository root */
export const REPO_ROOT = path.resolve(srcDir, '../../..')

/**
 * Stand-in secret so `pnpm dev` and `pnpm test` work with no .env at all.
 * Rejected outright in production, below.
 */
const DEV_SESSION_SECRET = 'dev-only-insecure-session-secret-change-me'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    HOST: z.string().min(1).default('127.0.0.1'),

    SESSION_SECRET: z.string().min(32).default(DEV_SESSION_SECRET),

    /** `file:` prefix optional. Relative paths resolve from the repository root. */
    DATABASE_URL: z.string().min(1).default('file:data/app.db'),
    UPLOAD_DIR: z.string().min(1).default('uploads'),

    APP_ORIGIN: z.url().default('http://localhost:5173'),

    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    VAPID_SUBJECT: z.string().min(1).default('mailto:admin@example.com'),

    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(120_000),

    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),

    /**
     * Skip email verification entirely: accounts are usable the moment they are
     * created. Defaults on in development, where waiting on a link printed to a
     * server log is friction with no security value on a local database.
     *
     * `z.coerce.boolean()` is deliberately not used here — it would read the
     * string "false" as true, which is the worst possible failure mode for a
     * flag that disables an auth check.
     */
    AUTO_VERIFY_EMAIL: z
      .enum(['true', 'false', '1', '0', 'yes', 'no'])
      .transform((value) => value === 'true' || value === '1' || value === 'yes')
      .optional(),
  })
  .refine(
    (value) => value.NODE_ENV !== 'production' || value.SESSION_SECRET !== DEV_SESSION_SECRET,
    {
      error: 'SESSION_SECRET must be set to a real secret in production',
      path: ['SESSION_SECRET'],
    },
  )
  .refine((value) => Boolean(value.VAPID_PUBLIC_KEY) === Boolean(value.VAPID_PRIVATE_KEY), {
    error: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together, or both left unset',
    path: ['VAPID_PUBLIC_KEY'],
  })
  // Refuse to boot rather than silently accept unverified addresses in production.
  .refine((value) => !(value.NODE_ENV === 'production' && value.AUTO_VERIFY_EMAIL === true), {
    error: 'AUTO_VERIFY_EMAIL cannot be enabled in production',
    path: ['AUTO_VERIFY_EMAIL'],
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  )
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
}

export const env = parsed.data

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
export const isDevelopment = env.NODE_ENV === 'development'

/**
 * Defaults to on in development only — deliberately *not* `!isProduction`, so the
 * test suite keeps exercising the real mandatory-verification path.
 */
export const autoVerifyEmail = env.AUTO_VERIFY_EMAIL ?? isDevelopment

/** Push is optional infrastructure. Without keys the app runs in-app-only. */
export const pushEnabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)

export const paths = {
  repoRoot: REPO_ROOT,
  /** Absolute, so `data/app.db` means the same file from any cwd. */
  databaseFile: path.resolve(REPO_ROOT, env.DATABASE_URL.replace(/^file:/, '')),
  uploadDir: path.resolve(REPO_ROOT, env.UPLOAD_DIR),
  webDist: path.resolve(REPO_ROOT, 'apps/web/dist'),
} as const
