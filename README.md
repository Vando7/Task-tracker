# Task Tracker

Household chores, organised by the physical layout of a home: **workspace (household) → floors →
rooms**, shared between the people living there.

This branch is the TypeScript rewrite. The Django implementation it replaces lives on `main`, and
`CLAUDE.md` holds the full rewrite brief plus a behavioural spec of the legacy app.

---

## Getting started

Node 22+ and pnpm. Nothing else — no database service, no mail server, no Redis, no Docker.

```bash
pnpm install
pnpm db:migrate          # create data/app.db and apply migrations
pnpm db:seed             # a plausible two-floor flat with three housemates
pnpm dev                 # API on :3001, client on :5173
```

Then open <http://localhost:5173> and sign in as any of the seeded users:

| Email | Password |
|---|---|
| `ivan@example.com` | `chores-are-fair` |
| `mira@example.com` | `chores-are-fair` |
| `deyan@example.com` | `chores-are-fair` |

No `.env` is needed for development; every variable has a working default and `.env.example`
documents the rest. Verification and password-reset links are printed to the server console, so
there is no mail server to run.

### Running the processes in the background

`pnpm dev` runs both in the foreground, which is what you want interactively. When you'd rather have
them detached:

```bash
./scripts/server.sh start          # both, detached, waits until each answers
./scripts/server.sh status         # what's up, on which port
./scripts/server.sh logs api       # follow the log
./scripts/server.sh restart web
./scripts/server.sh stop
```

Targets are `api`, `web`, or `all`. Logs and pidfiles go in `.run/` (gitignored). The script refuses
to start on a port something else already owns rather than fighting over it, and `stop` signals the
whole process group so watchers don't leak.

### Reaching it from another machine

Both servers bind loopback by default. To reach the app from a VM host, a phone, or anything else on
the network:

```bash
EXPOSE=1 ./scripts/server.sh start
# client started on http://192.168.99.101:5173 (also 127.0.0.1)

EXPOSE=1 pnpm dev            # same thing, foreground
```

`EXPOSE=1` does three things: binds `0.0.0.0`, opts Vite out of the Host-header check it uses to
resist DNS rebinding, and sets `APP_ORIGIN` to this host's address — without that last one the
verification and password-reset links point at `localhost` and are useless on the machine that has to
click them.

Strictly, only the client needs exposing: the browser only ever talks to Vite, which proxies `/api`
onward over loopback. The API is bound too, because anyone asking for this will reasonably want to
`curl` it directly.

Set `ALLOWED_HOSTS` to a comma-separated list if you'd rather keep Vite's host check meaningful
instead of allowing anything, and `WEB_PORT` / `PORT` to move the ports.

> **This is a development server.** In development the session cookie is not `secure`,
> `SESSION_SECRET` falls back to a known default, and the seeded accounts have a password published
> in this README. That is fine on a private network you control and not fine on an untrusted one.
> Reaching it from the public internet should go through a reverse proxy with TLS and a real
> `SESSION_SECRET`, not by exposing this port.

### Resetting

`data/app.db` is the whole database. Delete it and re-run `pnpm db:migrate && pnpm db:seed`.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API (`tsx watch`, :3001) + client (Vite, :5173); Vite proxies `/api` |
| `pnpm test` | Vitest, against a separate `data/test.db` |
| `pnpm check` | Biome lint + format |
| `pnpm typecheck` | `tsc --noEmit` across all three packages |
| `pnpm build` | typecheck, then build the client |
| `pnpm db:migrate` · `db:seed` · `db:studio` · `db:reset` | Prisma |

---

## Layout

```
apps/server     Fastify API: routes/ stay thin, services/ hold the logic,
                events/ is the SSE hub, jobs/ is the scheduler tick
apps/web        React 19 + Vite client
packages/shared Zod schemas — the single definition of every API shape
data/           SQLite (gitignored)
```

Client routes, all under a workspace (`/w/:workspaceId`):

| Route | Page |
|---|---|
| `/` | **Dashboard** — yours, then up-for-grabs, then the house at a glance |
| `/house` | the floor plan, and the only place floors and rooms are edited |
| `/tasks` | one list, filtered by room, floor, search and assignee via the query string |
| `/settings` | fairness tally, appearance, household, notifications, profile |

`packages/shared` is the **only** place an API shape is defined. The server validates requests *and*
responses against those schemas; the client imports the inferred types. If the two ever disagree
about a field, the schema is right.

Note the two types per request schema: `CreateTaskInput` is the parsed output (`dueDate` is a `Date`),
`CreateTaskBody` is what a client can actually send (an ISO string). The client wants the `Body` one.

---

## Stack

TypeScript throughout, strict. Node 22, Fastify, Zod, Prisma 7 over SQLite in WAL mode via the
better-sqlite3 driver adapter, React 19 + Vite, TanStack Query, Tailwind v4, hand-rolled sessions
with argon2id, Server-Sent Events, Web Push, Vitest, Biome.

Deliberately absent: Next.js, Postgres, Redis, any message broker or worker process, an auth library,
GraphQL and tRPC. `CLAUDE.md` §1 explains each.

The notification scheduler is a single `setInterval` in the API process. That is safe because delivery
is idempotent — see below.

---

## Things worth knowing before you change something

Each of these is load-bearing, and most exist because the legacy app got it wrong (`CLAUDE.md` Part 2
catalogues the originals).

- **`Task.workspaceId` is a direct foreign key.** Authorization is one indexed lookup,
  `requireMember(request, workspaceId)`, and every scoped query filters by it — so there is no
  post-hoc ownership check to forget. Inferring the workspace through `rooms → floor → workspace` was
  the root of nearly every authorization bug in the old app.
- **Out-of-workspace reads answer 404, not 403.** A 403 confirms the thing exists.
- **`TaskCompletion` is append-only and is the truth.** `Task.status` is a fast path. Recurrence,
  the fairness tally, room staleness and "last done 3 days ago" all read the log.
- **Notification delivery writes its ledger row first** and treats a unique-constraint violation as
  "already sent". That ordering is what makes overlapping scheduler ticks safe. The uniqueness key
  includes a `cycleKey`; keyed on only `(user, task, kind)`, a recurring task's reminder would fire
  once and then never again.
- **Overdue is an instant comparison** (`dueDate < now`), computed server-side. The workspace
  timezone is used for the things that genuinely need a calendar: "due today", quiet hours, the
  fairness window, and stepping a recurrence so a fortnightly 09:00 chore stays at 09:00 across a DST
  boundary.
- **A floor filter is the union of that floor's rooms.** The legacy one meant the intersection, so
  adding a room silently hid every existing floor-wide task.
- **Zero rooms and zero assignees are both valid.** A task belongs to the workspace directly, and
  unassigned means "whoever gets to it" — never render it as missing data.
- **Floors and rooms soft-delete**, and deleting one detaches it from tasks rather than cascading the
  join rows away.
- **Every mutation another member can see must publish an SSE event.** It is the thing that makes the
  app feel alive and the easiest thing to forget.
- **A floor's colour is one CSS custom property** set on that floor's subtree; tints and glows derive
  from it with `color-mix`. Don't reintroduce per-element gradients.
- **Every colour is a token, and both themes are real.** Utilities read `var(--color-*)`; the light
  theme reassigns those variables under `:root[data-theme='light']` in `apps/web/src/index.css`. So
  never hardcode a hex or reach for `bg-white`/`bg-black/30` in a component — it will look wrong in one
  of the two themes. `data-theme` is stamped by an inline script in `index.html` before first paint and
  owned by `lib/useTheme.ts` afterwards; the default follows the OS.
- **Buttons and inputs are the `btn` / `icon-btn` / `field` / `chip` utilities**, with colour variants
  paired (`icon-btn icon-btn-ghost`). Mixing a core utility like `bg-transparent` into one of them
  depends on stylesheet order and will eventually lose; add or use a variant instead.
- **Icons are the inline SVG set in `components/Icon.tsx`** — `currentColor`, `aria-hidden`, and never
  the only label on a control. Emoji stay for the things a *user* chose: floor and room icons.

---

## Tests

```bash
pnpm test
```

Vitest with Fastify's `.inject()`, so no listening socket. The suite is organised around the legacy
bug list — the IDOR cases, floor-filter semantics, badge counts excluding soft-deleted tasks, enum
and length validation, recurrence anchoring (including the DST and short-month cases), rotation, and
notification idempotency across repeated ticks.

---

## Deployment

`Dockerfile` builds a single image: build the client, install production dependencies, run one
Fastify process serving both, with `data/` and `uploads/` as volumes.

**It has never been built or run** — per the handoff in `CLAUDE.md` it was authored as a reviewable
artifact, not part of the dev loop. Treat its versions and paths as unverified.
