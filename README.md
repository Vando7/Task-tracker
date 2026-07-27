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
