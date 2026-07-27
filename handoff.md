# Handoff: deploying the `rewrite` branch to Hetzner with Docker

Context you need before touching anything:

- **`main` is the currently deployed Django app. This branch (`rewrite`) is a different
  application.** Not a port — a redesign. Checkout `rewrite`; do not merge or fast-forward `main`.
- **There is no data migration, by design.** The old Django database is not read, converted, or
  referenced. The household re-registers from scratch. Back the old DB up before you tear anything
  down, but don't plan on importing it.
- **Single user.** The owner is the only person who will use this. Prefer the simple option
  everywhere a tradeoff comes up; don't build for multi-tenancy or scale.
- **`Dockerfile` has never been built or run.** It was authored as a reviewable artifact. The two
  blockers below were found by reading it, not by running it — expect more.

---

## Blocker 1: the container cannot start as written

`Dockerfile:63` prunes dev dependencies:

```dockerfile
RUN pnpm install --frozen-lockfile --prod --ignore-scripts=false
```

But the runtime `CMD` needs two packages that are **devDependencies** in
`apps/server/package.json`:

- `prisma` — the CMD runs `prisma migrate deploy`
- `tsx` — `start` is `tsx --env-file-if-exists=../../.env src/index.ts`

So the prune deletes both, and the container fails on migrate, then on start.

This is not an accident of packaging: the server is deliberately never compiled to JavaScript.
`packages/shared` is consumed as TypeScript source so it stays the single definition of every API
shape, so `tsx` is a *runtime* dependency here, permanently.

**Lowest-risk fix:** delete line 63 entirely. The image keeps the full `node_modules`, which is
larger and completely fine for a single-user box.

Moving `tsx` and `prisma` into `dependencies` is arguably more correct, but it changes
`pnpm-lock.yaml`, and the earlier stages use `--frozen-lockfile` — so you'd have to regenerate the
lockfile locally and commit it. Don't do that on the server.

## Blocker 2: you cannot create an account in production mode

The Dockerfile hardcodes `NODE_ENV=production` (line 69). That triggers a chain with no exit:

1. In production, `autoVerifyEmail` is `false`, so email verification is mandatory
   (`apps/server/src/env.ts:95`).
2. Registration therefore calls `sendMail(verificationEmail(...))`, unguarded
   (`apps/server/src/services/auth.ts:72`).
3. `MAIL_TRANSPORT` defaults to `console`, and `sendMail` **throws** on `console` in production —
   "refuse to silently drop real mail" (`apps/server/src/services/mail.ts:20`).
4. `MAIL_TRANSPORT=smtp` also throws: no provider is implemented yet
   (`apps/server/src/services/mail.ts:41`).

Register returns a 500 either way. Worse, the `User` and `EmailToken` rows are written *before* the
throw, so you're left with an unverified account and a verification token whose plaintext was lost.

**Do not try to fix this with `AUTO_VERIFY_EMAIL=true`** — the env schema refuses to boot with that
enabled in production, on purpose (`apps/server/src/env.ts:71`).

**Recommended fix — no code change.** Verification state lives in the database, so mint the account
once in development mode and then run production normally:

1. Start the container once with `-e NODE_ENV=development` (also set a real `SESSION_SECRET`; the
   dev fallback is a published constant).
2. Register the owner's account. It is auto-verified immediately.
3. Stop it, drop the override, run with `NODE_ENV=production` from then on. The account is already
   verified and logs in fine.

The same trick rescues an account already stuck unverified: booting in development mode verifies an
existing unverified account on next login.

Note the standing consequence: **password reset stays broken** until `sendMail` gets a real SMTP
implementation, because it goes through the same throw. For a single user who knows their password
that is acceptable; if it ever matters, `mail.ts` is a one-function change and is the only place that
needs to change.

---

## HTTPS is mandatory, not optional

`apps/server/src/auth/session.ts:23` sets `secure: isProduction` on the session cookie. Served over
plain HTTP in production, the browser silently refuses to store it — login *appears* to succeed and
every subsequent request is unauthenticated. This failure looks like a bug in the app.

So: real domain, TLS terminating in front of the container. Caddy is the least work. Then set
`APP_ORIGIN` to that exact `https://…` origin — it's used for emailed links and for the deep link
inside push payloads (`apps/server/src/services/notifications.ts:171`).

Push additionally requires a secure context on the client, so HTTPS gets you that at the same time.

## Environment

No `.env` is committed and `.dockerignore` excludes it, so pass these on `docker run`. If you mount a
file instead, it must land at `/app/.env` — that's the path the `start` script looks at.

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | **Required in production**, min 32 chars. The dev fallback is a known constant and the schema rejects it. |
| `APP_ORIGIN` | The public `https://` origin. Wrong value = broken verify links and push taps. |
| `NODE_ENV` | `production`, except for the one-time account creation above. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional. `npx web-push generate-vapid-keys`. Must be set together or both unset, or boot fails. Without them the app is fully functional minus push. |
| `VAPID_SUBJECT` | `mailto:` address. Defaults to a placeholder. |
| `MAIL_TRANSPORT` | Leave default. Both values throw in production — see Blocker 2. |
| `SCHEDULER_INTERVAL_MS` | Default 120000. Fine. |

Already baked into the image: `HOST=0.0.0.0`, `PORT=3001`, `DATABASE_URL=file:data/app.db`,
`UPLOAD_DIR=uploads`.

## Volumes

Two, both required, or every redeploy loses the household:

- `/app/data` — SQLite lives at `/app/data/app.db`
- `/app/uploads` — avatars

The container runs as `node` (uid 1000); make sure the host directories are writable by it.

There is **no compose file** in the repo. Write one, or use `docker run` — either is fine, but the
volumes and the env table above are not optional.

## Migrations

The CMD runs `prisma migrate deploy` on every boot, before starting the server. That's deliberate:
the database is a mounted volume so it doesn't exist at build time, and `deploy` only applies
committed migrations — it never generates or resets. Safe to run unattended.

One unverified detail: `prisma.config.ts` is TypeScript, and the CLI has to load it to get the
datasource URL. Prisma 7 is supposed to handle that itself. If `migrate deploy` fails on config
loading, that's your cause, and it's another reason not to prune `tsx`.

---

## Order of operations

Don't destroy the old instance until the new one is confirmed working — they're separate apps with
separate databases, so nothing stops them coexisting on different ports for an afternoon.

1. Back up the Django database and `uploads/` off the box.
2. Build the image. Expect Blocker 1; apply the fix.
3. Run it on a spare port, still behind TLS, with the volumes mounted.
4. Create the account (Blocker 2 procedure). Confirm login persists across a page reload — that's
   the cookie/HTTPS check.
5. Walk through it once: create a floor, a room, a task, complete it. Confirm the SSE stream is live
   (open two tabs, change something in one).
6. Only then stop the Django app and move the new one onto the real port/hostname.
7. Optional: VAPID keys, then enable push from Settings → Notifications on the phone.

## Sanity checks once it's up

- `GET /api/health` — liveness, and reports whether push is configured.
- `GET /api/events/stats` — hub subscriber counts, confirms SSE.
- `pnpm db:seed` exists but seeds a demo household with published passwords. **Don't run it on the
  real instance.**

## Things that are working as intended, not bugs

Worth knowing so you don't "fix" them:

- A task with **zero rooms or zero assignees is valid**. Unassigned means "whoever gets to it".
- **Comments cannot be edited.** No edit endpoint, no `updatedAt`. Author can delete theirs.
- **Cross-workspace reads answer 404, not 403** — a 403 would confirm the thing exists.
- **Reactions only go on comments**, never on tasks or completions.
- The fairness tally is a **plain count**. No points, streaks, or badges, deliberately.

`CLAUDE.md` is the full reference for how the app is built and which parts are load-bearing. It is
accurate about the application; it is optimistic about the Dockerfile. Note it's excluded by
`.dockerignore`, so read it from the repo, not the image.
