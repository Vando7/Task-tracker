# Task Tracker

**A household chore tracker.** Tasks are organised by the physical layout of a home —
workspace (household) → floors → rooms — and shared between the people living there. The spatial
model is the point: it is what makes this different from a flat to-do list.

TypeScript everywhere, strict. Fastify + Prisma + SQLite on the server, React 19 + Vite on the
client, one `packages/shared` holding the Zod schemas that define every API shape.

> This branch replaced a Django implementation, which still sits on `main` and is deployed.
> Comments in the source that say "the legacy app" mean that one. Nothing here depends on it: the
> data model is a redesign rather than a port, no legacy ids are carried, and existing households
> re-register rather than being migrated.

`README.md` is the getting-started guide — install, seeded logins, running detached, exposing to the
network. This file is the reference: how the app is built and which parts are load-bearing.

---

## Rules

These are the invariants. Most of them exist because breaking them is how the previous
implementation went wrong, and each is cheap to honour and expensive to retrofit.

**Contract**

- `packages/shared` is the **only** place an API shape is defined. The server validates requests
  *and* responses against those schemas; the client imports the inferred types. If the two ever
  disagree about a field, the schema is right.
- Note the two types per request schema: `CreateTaskInput` is the parsed output (`dueDate` is a
  `Date`), `CreateTaskBody` is what a client can actually send (an ISO string). The client wants
  `Body`.
- Route handlers stay thin: parse → authorize → call a service → emit an event → respond. Anything
  interesting lives in `services/`.
- No business logic in React components. Data access goes through TanStack Query hooks in
  `features/*/api.ts`.

**Authorization**

- `Task.workspaceId` is a **direct foreign key**. Authorization is one indexed lookup,
  `requireMember(request, workspaceId)`, and every scoped query filters by it — so there is no
  post-hoc ownership check to forget. Inferring a task's workspace through
  `rooms → floor → workspace` was the root of nearly every authorization bug in the old app.
- **Out-of-workspace reads answer 404, not 403.** A 403 confirms the thing exists.
- `TaskRoom` rows must always point at rooms inside the task's own workspace. SQLite cannot express
  that, so `assertRoomsInWorkspace` enforces it and a test asserts it.

**Data**

- **`TaskCompletion` is append-only and is the truth.** `Task.status` is a fast path. Recurrence, the
  fairness tally, room staleness and "last done 3 days ago" all read the log.
- **Zero rooms and zero assignees are both valid.** A task belongs to the workspace directly, and
  unassigned means "whoever gets to it" — never render either as missing data or as an empty slot
  demanding to be filled.
- **Floors and rooms soft-delete**, and deleting one detaches it from tasks rather than cascading the
  join rows away.
- **A floor filter is the union of that floor's rooms**, never the intersection.
- **Overdue is an instant comparison** (`dueDate < now`), computed server-side. The workspace
  timezone is for the things that genuinely need a calendar: "due today", quiet hours, the fairness
  window, and stepping a recurrence so a fortnightly 09:00 chore stays at 09:00 across a DST
  boundary.

**Liveness**

- **Every mutation another member can see publishes an SSE event.** Not optional — it is the thing
  that makes the app feel alive and the easiest thing to forget.
- **Notification delivery writes its ledger row first** and treats a unique-constraint violation as
  "already sent". That ordering is what makes overlapping scheduler ticks safe.

**Interface**

- **Every colour is a token, and both themes are real.** Utilities read `var(--color-*)`; the light
  theme reassigns those variables under `:root[data-theme='light']` in `apps/web/src/index.css`.
  Never hardcode a hex or reach for `bg-white` / `bg-black/30` in a component — it will look wrong in
  one of the two themes.
- **A floor's colour is one CSS custom property** (`--floor`) set on that floor's subtree; tints and
  glows derive from it with `color-mix`. Don't reintroduce per-element gradients.
- **Buttons and inputs are the `btn` / `icon-btn` / `field` / `chip` utilities**, with colour
  variants paired (`icon-btn icon-btn-ghost`). Mixing a core utility like `bg-transparent` into one
  of them depends on stylesheet order and will eventually lose; add or use a variant instead.
- **Icons are the inline SVG set in `components/Icon.tsx`** — `currentColor`, `aria-hidden`, and
  never the only label on a control. Emoji stay for the things a *user* chose: floor and room icons.
- Phone is the primary target: 44px minimum tap targets (the `tap` utility), thumb-reachable primary
  actions, no hover-dependent affordances.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS | boring, current |
| Package manager | pnpm (workspaces) | fast, strict about phantom deps |
| API server | Fastify | small, typed, first-class plugins, trivial SSE |
| Validation | Zod | one schema is both runtime validation and the shared TS type |
| DB | SQLite (`better-sqlite3`), WAL mode | a household app has a handful of users; a file is the right answer |
| ORM | Prisma 7 | one declarative schema, real migrations, excellent generated types |
| Frontend | React 19 + Vite | fastest feedback loop, no SSR complexity we don't need |
| Routing | React Router (declarative) | filters live in the URL, which this app needs |
| Server state | TanStack Query | caching, optimistic updates, SSE-driven cache writes |
| Styling | Tailwind CSS v4 | per-floor theming becomes CSS custom properties, not inline gradients |
| Auth | hand-rolled sessions + argon2id | ~150 lines, fully auditable, no library churn |
| Live updates | Server-Sent Events | one direction is all we need |
| Push | Web Push (VAPID) + Service Worker | required for anything time-based |
| Scheduling | one in-process `setInterval` | single-process app, so no broker at all |
| Tests | Vitest + Fastify `.inject()` | no HTTP server needed for API tests |
| Lint/format | Biome | one tool, one config, fast |

Prisma 7 has no query engine binary, so the client connects through the `better-sqlite3` driver
adapter — which is also how we control the pragmas, notably WAL. The connection URL lives in
`apps/server/prisma.config.ts`.

Deliberate non-choices, so they don't get relitigated:

- **No Next.js.** No SSR or SEO need, and RSC/server actions would complicate SSE and obscure the API
  boundary. An explicit client + explicit API is easier to work on.
- **No Postgres.** Household scale. SQLite in WAL mode handles this with room to spare, and it makes
  local development a single file with zero services running.
- **No Redis, no message broker, no worker process.** The notification scheduler is a `setInterval`
  in the API process, and that is safe precisely because delivery is idempotent.
- **No auth library.** Email+password with sessions is a small amount of explicit code, and explicit
  beats configurable here. Revisit only if OAuth ever comes back.
- **No GraphQL, no tRPC.** A plain REST-ish JSON API with Zod schemas shared through
  `packages/shared` gives end-to-end types without extra machinery.

---

## Repository layout

```
apps/
  server/
    src/
      index.ts              # entry: build the app, listen, start the scheduler
      app.ts                # Fastify bootstrap, plugins, error handler, route registration
      env.ts                # Zod-validated process.env
      db.ts                 # Prisma client singleton
      auth/                 # password hashing, sessions, tokens, middleware
      routes/               # one file per resource: auth, me, workspaces, layout,
                            #   tasks, events (SSE), notifications
      services/             # business logic — tasks, layout, recurrence, notifications,
                            #   push, mail, time, workspaces, serialize
      events/hub.ts         # SSE hub: per-workspace subscriber registry
      jobs/scheduler.ts     # the scheduler tick
      lib/                  # HttpError, request validation
      test/
    prisma/                 # schema.prisma, migrations/, seed.ts
  web/
    src/
      main.tsx, App.tsx     # routing and the workspace shell
      routes/               # one file per page
      components/           # Shell, TaskCard, NewTaskDialog, Avatar, Icon, InlineText, ThemeToggle
      features/             # tasks/, layout/, session/, stats/, notifications/ — hooks per domain
      lib/                  # api client, useEventStream, useTheme, formatting, query keys
    public/sw.js            # service worker (push handling)
packages/
  shared/src/
    schemas/                # Zod schemas — the API contract
    constants.ts            # enums, limits, defaults
data/app.db                 # gitignored
uploads/                    # avatars, gitignored
Dockerfile                  # written, never built or run
```

Client routes, all under a workspace (`/w/:workspaceId`):

| Route | Page |
|---|---|
| `/` | **Dashboard** — yours, then up-for-grabs, then the house at a glance |
| `/house` | the floor plan, and the only place floors and rooms are edited |
| `/tasks` | one list, filtered by room, floor, search and assignee via the query string |
| `/settings` | fairness tally, appearance, household, notifications, profile |

---

## Data model

Prisma over SQLite. `apps/server/prisma/schema.prisma` carries a comment on each model explaining
why it looks the way it does; this is the summary.

```
User            id, email (unique), passwordHash, name, avatarPath?, emailVerifiedAt?
Session         id, userId, expiresAt, userAgent?, ip?     # the id is the cookie value
EmailToken      id, tokenHash (unique), userId, kind (verify|reset), expiresAt, usedAt?

Workspace       id, name, timezone, createdById?
Member          workspaceId, userId, role (owner|member)   # composite PK

Floor           id, workspaceId, name, icon, color, sortOrder, deletedAt?
Room            id, floorId, name, icon, sortOrder, deletedAt?

Task            id, workspaceId, name, description, category, categoryRank, status,
                dueDate?, recurrenceEvery?, recurrenceUnit?, recurrenceAnchor,
                rotateAssignees, createdById?, deletedAt?
TaskRoom        taskId, roomId                             # composite PK
TaskAssignee    taskId, userId, assignedAt, assignedById?  # composite PK
TaskCompletion  id, taskId, completedById?, completedAt    # append-only

PushSubscription  id, userId, endpoint (unique), p256dh, auth
NotifyPreference  userId (PK), enabled, onAssigned, onDueSoon, onOverdue,
                  onCompletedByOther, dueSoonLeadHours, quietFrom?, quietTo?
NotifyLog         id, userId, workspaceId, taskId?, kind, cycleKey, actorId?, sentAt, readAt?
                  # unique (userId, taskId, kind, cycleKey)
```

Points worth knowing:

- **`EmailToken` stores only the SHA-256** of the emailed token. A leaked database must not hand out
  working reset links. `usedAt` makes them single-use.
- **`categoryRank`** is a numeric mirror of `category` (urgent 0, special 1, normal 2), maintained by
  the task service. Sorting has to happen in SQL or pagination silently reorders across pages, and
  SQLite cannot `ORDER BY` a `CASE` through Prisma.
- **`status` is `todo | done` only.** Overdue is derived, never stored.
- **`NotifyLog` is both the delivery ledger and the in-app feed.** `cycleKey` is part of the unique
  constraint on purpose: keyed on only `(user, task, kind)`, a recurring task's reminder would fire
  once and then never again — which is the bug you get from fixing re-delivery carelessly.
- Timestamps are stored UTC.
- `sortOrder` on Floor and Room, so the layout can be arranged.

---

## HTTP surface

All JSON, all under `/api`, all requiring a session except health, the auth routes and verification.
Errors are `{ error: { message, code, fields? } }`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness, plus whether push is configured |
| POST | `/api/auth/register` · `/login` · `/verify` · `/logout` · `/logout-all` | session lifecycle |
| POST | `/api/auth/password/reset-request` · `/password/reset` | password reset |
| GET/PATCH | `/api/me` | the signed-in user and their workspaces |
| POST | `/api/me/password` · `/api/me/avatar` | credentials, avatar upload |
| GET/POST | `/api/workspaces` | list, create |
| PATCH/DELETE | `/api/workspaces/:id` | rename; delete is owner-only |
| GET/POST | `/api/workspaces/:id/members` | list, add by email |
| DELETE | `/api/workspaces/:id/members/:userId` | remove |
| GET | `/api/workspaces/:id/stats/fairness` · `/stats/staleness` | the tally, room staleness |
| GET | `/api/workspaces/:id/layout` | floors + rooms + badge counts, one call |
| POST | `/api/workspaces/:id/floors` · `/floors/reorder` | create, reorder |
| PATCH/DELETE | `/api/floors/:id` | edit, soft-delete |
| POST | `/api/floors/:id/rooms` · `/rooms/reorder` | create, reorder |
| PATCH/DELETE | `/api/rooms/:id` | edit, soft-delete |
| GET/POST | `/api/workspaces/:id/tasks` | filtered list, create |
| GET/PATCH/DELETE | `/api/tasks/:id` | read, edit, soft-delete |
| POST | `/api/tasks/:id/complete` · `/reopen` | complete (drives recurrence), manual reset |
| POST/DELETE | `/api/tasks/:id/rooms[/:roomId]` | attach, detach |
| POST/DELETE | `/api/tasks/:id/assignees[/:userId]` | assign, unassign |
| GET | `/api/events?workspaceId=` | the SSE stream |
| GET | `/api/events/stats` | hub subscriber counts |
| GET/PATCH | `/api/notifications/preferences` | per-user notification settings |
| GET | `/api/notifications` · `/vapid-public-key` | the in-app feed, the push key |
| POST | `/api/notifications/subscribe` · `/unsubscribe` · `/:id/read` · `/read-all` | push and feed state |

Floors, rooms and tasks own their full paths rather than nesting under a workspace, because they are
addressed by their own ids as often as by their parent's.

---

## Features

### Authentication

Email + password only. No social login, no OAuth plumbing.

- Passwords hashed with argon2id. Sessions are opaque random ids in a `Session` row, delivered as an
  `httpOnly`, `sameSite=lax`, `secure`-in-production cookie. No JWTs — logout is a row delete, and
  logging out everywhere deletes every row for the user.
- Email verification is mandatory before login succeeds, except that `AUTO_VERIFY_EMAIL` (on by
  default in development) skips it and verifies an existing unverified account on next login. The
  server **refuses to boot** with that enabled in production.
- In development, verification and reset links are printed to the server console — no SMTP, no
  Mailpit. Production goes through one `sendMail()` behind `MAIL_TRANSPORT`.
- Login, register and reset-request are rate-limited; nothing else is, because a household app has no
  reason to throttle its own members browsing task lists.
- Avatars are uploaded files served from `/uploads/`. `avatarPath` being null is the normal case, so
  the initials avatar is the default path rather than an error state.

### Workspaces and membership

Ordinary CRUD resources. Create, rename, delete (owner-only). A user may belong to several, and
belonging to **none** is a normal state — the UI shows a create prompt. There is no auto-creation on
login.

`POST /api/workspaces/:id/members` takes an email and requires that the account already exist; an
unknown address returns a 400 worded so it is not an account-existence oracle. Removing a member also
removes their assignments in that workspace.

### Floors, rooms, and the house view

`/w/:id/house` is the floor plan and the only place floors and rooms are edited. Each floor carries
an emoji, a name, a colour and a sort order; each room an emoji, a name and a sort order. Room badges
show open task counts (excluding soft-deleted tasks) and staleness — "nothing done in 12 days" —
which is what makes the spatial view answer "what needs attention?".

### Tasks

Name, description, category (`urgent | special | normal`), status (`todo | done`), optional due date,
optional recurrence, zero or more rooms, zero or more assignees. Pending order is
urgent → special → normal, then most recently updated, done in SQL via `categoryRank`.

Every control on a card saves immediately — no Save button, no dirty state — through an optimistic
mutation with rollback. Card state lives in React keyed by task id.

### Assignees and filtering

Assignment is its own endpoint rather than a generic field update, so it can be notified on and
recorded with who assigned whom. The task list filters by room, floor, search and assignee
(*Anyone* · *Mine* · *Unassigned* · specific members), all combinable, all in the URL query string so
a filtered view is linkable and survives reload.

### Recurrence

`recurrenceEvery` + `recurrenceUnit` (`day | week | month`); null means one-off. On completion, a
recurring task's next due date is computed and it returns to `todo`. `recurrenceAnchor` picks where
from:

- **`completion`** (the default) — "every 2 weeks from when I actually did it". Late completions push
  the schedule out; you never owe a backlog of missed cycles.
- **`dueDate`** — "every other Sunday". The cadence holds regardless of when it was done, so it keeps
  stepping until the result is in the future; a task completed five weeks late does not come back
  already overdue.

Both paths, plus the DST and short-month cases, are covered in `src/test/recurrence.test.ts`.
`POST /tasks/:id/reopen` is the manual escape hatch.

### The completion log

One append-only `TaskCompletion` row per completion — task, who, when. Three columns that unlock
recurrence ("when was this last done"), the fairness tally ("who did what"), room staleness ("nothing
here in 12 days") and notification history. Cards show "last done 3 days ago" from it.

### Fairness and rotation

`Task.rotateAssignees`: on completion of a recurring task, advance to the next person in the rotation
instead of keeping the current assignee. Alongside it, a per-workspace tally of completions per
person over the last week or month, evaluated in the workspace timezone.

Deliberately a plain count: **no points, no streaks, no badges.** Gamifying chores between people who
live together tends to curdle; an honest tally provides the accountability without keeping score.

### Live updates

`GET /api/events` holds one long-lived response per client. The hub in `events/hub.ts` is a map of
workspaceId → subscribers, so publishing fans out to that workspace only.

Event types are `task.created|updated|deleted|assigned|unassigned`, `floor.*`, `room.*`,
`member.added|removed`, and `notification`. Each envelope carries `id`, `type`, `workspaceId`,
`actorId`, `at` and the changed entity — so `useEventStream` writes it straight into the query cache
by id, and a client can skip echoing back its own change, which is what keeps optimistic updates from
flickering. `EventSource` reconnects on its own; on reconnect the current view refetches once to
close the gap. A comment line every 25s keeps intermediaries from dropping the connection.

### Notifications

Two paths. **In-app** events arrive over the same SSE channel and surface as a toast plus an unread
badge, so they work even if the user refuses push. **Web Push** covers the tab being closed, which is
the only way a deadline reminder is worth anything.

| Event | Trigger | Recipients |
|---|---|---|
| `assigned` | someone adds you to a task | the newly assigned user |
| `due_soon` | `dueDate` minus the user's lead time | assignees, or all members if unassigned |
| `overdue` | `dueDate` passes, task not done | assignees, or all members if unassigned |
| `completed_by_other` | a task you're assigned to is completed by someone else | the other assignees |

- Permission is requested **contextually**, when the user first enables notifications in settings.
  Never on page load.
- `NotifyPreference` per user: master switch, per-event toggles, `due_soon` lead time, quiet hours.
  Quiet hours suppress push, not the in-app feed.
- Time-based events come from one scheduler tick (`SCHEDULER_INTERVAL_MS`, default two minutes),
  which also prunes expired sessions. The scan is bounded by the largest configurable lead time.
- Expired or rejected push subscriptions (410/404 from the push service) are deleted on the spot.
- Notifications are strictly additive. If push is denied, unsupported, or the server has no VAPID
  keys, the app behaves exactly as it would without it, and settings says so.

### The dashboard

`/w/:id` is the landing page and answers "what am I on the hook for?" in reading order:

1. **Yours** — pending tasks assigned to you, overdue first, then soonest deadline, then category.
2. **Up for grabs** — pending unassigned tasks, each offering a one-tap "I'll do it". Claiming is an
   offer, never a demand; unassigned remains a valid resting state.
3. **The house at a glance** — overdue / due-today / open / done-this-week counts, the rooms that have
   gone longest untouched, who is carrying what, this week's tally, and the floor list.

One `status=todo` query feeds all of it, partitioned in the client: separate mine/unassigned/others
requests would fetch the same rows and still not give the counts. "Due today" is evaluated in the
workspace timezone, not the browser's.

### Theming and PWA

`light | dark | system`, defaulting to `system`, persisted per device. `data-theme` is stamped on
`<html>` by an inline script in `index.html` before first paint — otherwise a user who chose light
gets a dark flash on every load — and owned by `lib/useTheme.ts` from mount onwards through a
module-level store, so the header toggle and the Settings selector cannot disagree.

A service worker is already present for push, so installability and an app icon come nearly free;
`public/manifest.webmanifest` and `public/icon.svg` complete it.

---

## Decisions

Settled, with the reasoning, so they don't get reopened by accident:

- **Start clean, no data migration.** No legacy id columns anywhere in the schema and no
  export/import script. Existing households re-register. Revisiting this is a migration, not a
  no-op — the schema reserves no space for legacy ids.
- **Recurrence anchors to the completion by default**, with `dueDate` available per task, because
  both behaviours are legitimate and the column is cheap.
- **Timezone is per workspace**, so every member of a household agrees on what "today" means. Quiet
  hours stay per-user, since those are about sleep.
- **Full workspace CRUD with multi-workspace membership**, and belonging to none is a normal state.
- **Membership by exact email, no invitations** — the interim behaviour. Emailed invite links with a
  pending state would need an `Invite` table and a token flow; **this one is still open**, and it is
  the obvious next thing if adding a housemate proves annoying in practice.

---

## Commands

Native. No Docker in the dev loop.

```bash
pnpm install
pnpm db:migrate           # prisma migrate dev
pnpm db:seed              # a plausible two-floor flat with three housemates
pnpm db:studio            # prisma studio
pnpm db:reset             # prisma migrate reset

pnpm dev                  # server (tsx watch, :3001) + web (vite, :5173) together
                          # vite proxies /api -> :3001

pnpm test                 # vitest, against a separate data/test.db
pnpm check                # biome lint + format  (check:fix to write)
pnpm typecheck            # tsc --noEmit across all three packages
pnpm build                # typecheck, then build the client

./scripts/server.sh start # run api and/or web detached; also stop|restart|status|logs
EXPOSE=1 pnpm dev         # bind 0.0.0.0 and set APP_ORIGIN, to reach it from a phone
```

`pnpm build` **typechecks but does not emit server JavaScript.** `packages/shared` is consumed as
TypeScript source so that it stays the single definition of every API shape; compiling the server
separately would mean either building `shared` twice or emitting an import that cannot resolve at
runtime. So the server runs through `tsx` in production too, and `tsc --noEmit` is the gate that
fails the build.

Environment is validated by Zod at boot in `apps/server/src/env.ts` — a typo fails immediately with a
readable message. `.env.example` is committed and stays in sync. No `.env` is needed for development;
every variable has a working default. Web Push in dev needs one `npx web-push generate-vapid-keys`
into `.env`, and works on `localhost` without HTTPS.

SQLite lives at `data/app.db`. Deleting it and re-running `db:migrate && db:seed` is the reset button.

---

## Tests

Vitest with Fastify's `.inject()`, so no listening socket and no port to collide with.
`src/test/api.test.ts` covers the API surface and pins the authorization behaviour shut — the
cross-workspace IDOR cases, floor-filter semantics, badge counts excluding soft-deleted tasks, enum
and length validation. `src/test/recurrence.test.ts` covers both anchors, DST and short months.
Notification idempotency is exercised by running the scheduler tick repeatedly and asserting nothing
sends twice.

---

## Deployment

`Dockerfile` is a multi-stage build producing a single image: build the client, install production
dependencies, run one Fastify process serving both, with `data/` and `uploads/` as volumes.

**It has never been built or run.** It was authored as a reviewable artifact rather than part of the
dev loop, so treat its versions and paths as unverified until someone actually builds it.
