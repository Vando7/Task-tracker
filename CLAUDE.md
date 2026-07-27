# Task Tracker — rewrite brief & legacy spec

**Task Tracker is a household chore tracker.** Tasks are organised by the physical layout of a home —
workspace (household) → floors → rooms — and shared between the people living there.

There is a working Django implementation in this repo. **It is being replaced, not refactored.** The
product behaviour is worth keeping; the code is not. Django is being dropped entirely in favour of a
TypeScript stack on SQLite.

This file has two halves:

- **Part 1 — The rewrite.** Target stack, layout, data model, feature specs, decisions. This is the
  work.
- **Part 2 — The legacy app.** A behavioural spec of what exists today, and an inventory of its bugs.
  This is the requirements baseline: it's what the rewrite has to match or deliberately change.

---

## HANDOFF — read this first

You are picking this up fresh. Here's the situation and what to do.

The `main` branch holds the legacy Django app, which is deployed and should be left alone. **Create a
`rewrite` branch off `main` and do all work there.** Do not delete the Django code yet — Part 2 of
this document is a summary, and the original source is the tiebreaker when a behavioural question
comes up. It gets removed at cutover, not before.

**Run everything natively.** Node and pnpm on the host, SQLite as a file on disk. No Docker for
development — do not start containers, do not run compose, do not touch the existing `local.yml` /
`production.yml` / `compose/` files. Separately, **do write a `Dockerfile`** for the new app so
deployment is ready when we want it, but treat it as a build artifact to be authored and reviewed, not
executed. Don't build it, don't run it, don't verify it by running it.

Suggested order of work, each step ending somewhere runnable:

1. Scaffold the workspace (Part 1 §2), get `pnpm dev` serving an empty React page and a Fastify
   health endpoint.
2. Prisma schema (§3) + first migration + a seed script with a plausible two-floor house.
3. Auth: register, verify, login, logout, session middleware, `GET /api/me` (§4.2).
4. Workspaces, floors, rooms — CRUD and the layout view.
5. Tasks — CRUD, room assignment, the pending/completed lists, inline editing.
6. Assignees + filtering (§4.1).
7. SSE live updates (§4.4).
8. Recurrence + the completion log (§5.1, §5.2).
9. Notifications (§4.3) — last, because it's the only part that isn't load-bearing.
10. The `Dockerfile` (write only).

Read §6 before you start — there are open questions there that change what you build, and the answers
are the user's to give, not yours to assume. Ask them when you reach the step that depends on one; do
everything that doesn't depend on an answer first.

---

# PART 1 — THE REWRITE

## 1. Stack

TypeScript everywhere, strict mode. Chosen for being conventional, well-documented, and easy for both
a human and an agent to reason about — no clever indirection, no framework magic.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS | boring, current |
| Package manager | pnpm (workspaces) | fast, strict about phantom deps |
| API server | Fastify | small, typed, first-class plugins, trivial SSE |
| Validation | Zod | one schema is both runtime validation and the shared TS type |
| DB | SQLite (`better-sqlite3`), WAL mode | a household app has a handful of users; a file is the right answer |
| ORM | Prisma | one declarative schema file, real migrations, excellent generated types |
| Frontend | React 19 + Vite | fastest feedback loop, no SSR complexity we don't need |
| Routing | React Router (declarative) | filters live in the URL, which this app needs |
| Server state | TanStack Query | caching, optimistic updates, and an SSE-driven cache invalidation story |
| Styling | Tailwind CSS v4 | the per-floor colour theming becomes CSS custom properties, not 40 inline gradients |
| Auth | hand-rolled sessions + argon2 | ~150 lines, fully auditable, no library churn |
| Live updates | Server-Sent Events | one direction is all we need; see §4.4 |
| Push | Web Push (VAPID) + Service Worker | see §4.3 |
| Scheduling | one in-process interval | single-process app, so no Celery/Redis/broker at all |
| Tests | Vitest + Fastify `.inject()` | no HTTP server needed for API tests |
| Lint/format | Biome | one tool, one config, fast |

Deliberate non-choices, so they don't get relitigated:

- **No Next.js.** We need no SSR or SEO, and RSC/server actions would complicate SSE and obscure the
  API boundary. An explicit client + explicit API is easier to work on.
- **No Postgres.** Household scale. SQLite in WAL mode handles this with room to spare, and it makes
  local development a single file with zero services running.
- **No Redis, no message broker, no worker process.** The notification scheduler is a `setInterval` in
  the API process. This is the one place where dropping Django/Celery makes the design genuinely
  simpler, not just different.
- **No auth library** (Better Auth, Auth.js). Email+password with sessions is a small amount of
  explicit code, and explicit beats configurable here. Revisit only if OAuth ever comes back.
- **No GraphQL, no tRPC.** A plain REST-ish JSON API with Zod schemas shared through
  `packages/shared` gives end-to-end types without extra machinery.

## 2. Repository layout

```
apps/
  server/
    src/
      index.ts              # Fastify bootstrap
      env.ts                # Zod-validated process.env
      db.ts                 # Prisma client singleton
      auth/                 # password hashing, sessions, middleware
      routes/               # one file per resource: auth, workspaces, floors,
                            #   rooms, tasks, assignees, events (SSE), notifications
      services/             # business logic — recurrence, rotation, notifications
      events/               # SSE hub: per-workspace subscriber registry
      jobs/                 # the scheduler tick
      test/
    prisma/
      schema.prisma
      migrations/
      seed.ts
  web/
    src/
      main.tsx
      routes/               # one file per page
      components/
      features/             # tasks/, layout/, notifications/ — hooks + UI per domain
      lib/                  # api client, SSE hook, formatting
      sw.ts                 # service worker (push handling)
packages/
  shared/
    src/
      schemas/              # Zod schemas — the API contract
      types.ts              # types inferred from the schemas
      constants.ts          # category/status enums, recurrence units
data/
  app.db                    # gitignored
Dockerfile                  # written, never run during development
```

Rules that keep this crisp:

- `packages/shared` is the **only** place an API shape is defined. The server validates requests and
  responses against those schemas; the web client imports the inferred types. If the two ever disagree
  about a field, the schema is right.
- Route handlers stay thin: parse → authorize → call a service → emit an event → respond. Anything
  interesting lives in `services/`.
- No business logic in React components. Data access goes through TanStack Query hooks in
  `features/*/api.ts`.
- Every mutation that changes something another member can see emits an SSE event. Not optional — it's
  the thing that makes the app feel alive, and it's easy to forget.

## 3. Data model

Prisma/SQLite. This is a deliberate redesign, not a port — the notes explain what changed and why.

```
User            id, email (unique), passwordHash, name, avatarPath?,
                emailVerifiedAt?, createdAt
Session         id, userId, expiresAt                    # opaque cookie value
EmailToken      id, userId, kind (verify|reset), expiresAt, usedAt?

Workspace       id, name, createdById, createdAt
Member          workspaceId, userId, role (owner|member)  # composite PK
                # replaces the legacy "created_by == you means you're the admin" hack

Floor           id, workspaceId, name, icon, color, sortOrder, deletedAt?
Room            id, floorId, name, icon, sortOrder, deletedAt?

Task            id, workspaceId,                          # <-- direct FK. see note.
                name, description, category, status,
                dueDate?, recurrenceEvery?, recurrenceUnit?, rotateAssignees,
                createdById, createdAt, updatedAt, deletedAt?
TaskRoom        taskId, roomId                            # composite PK
TaskAssignee    taskId, userId, assignedAt, assignedById  # composite PK

TaskCompletion  id, taskId, completedById, completedAt    # append-only. see §5.1.

PushSubscription    id, userId, endpoint (unique), p256dh, auth, createdAt
NotifyPreference    userId (PK), enabled, onAssigned, onDueSoon, onOverdue,
                    onCompletedByOther, dueSoonLeadHours, quietFrom?, quietTo?
NotifyLog           id, userId, taskId, kind, sentAt      # idempotency, see §4.3
```

Notes on the changes:

- **`Task.workspaceId` is a direct foreign key.** In the legacy app a task's workspace was inferred
  through `rooms → floor → workspace`, and nearly every authorization bug in Part 2 is a symptom of
  that. Every query and every permission check gets simpler. `TaskRoom` rows must always point at
  rooms inside the task's own workspace — enforce it in the service layer, and assert it in a test.
- **`Member` with a role** replaces comparing against `created_by`. Fixes the legacy bug where
  membership management broke entirely for anyone who created two workspaces.
- **`TaskCompletion` is the keystone.** See §5.1 — it's what makes recurrence, fairness stats, room
  staleness, and notification idempotency all possible. The legacy app overwrote a single
  `completed_date` and destroyed its own history.
- **Floors and Rooms soft-delete.** Hard cascade in the legacy app orphaned tasks into permanent
  invisibility. Deleting a room detaches it from tasks; a task left with zero rooms is still valid
  (it belongs to the workspace directly now) and must remain reachable.
- **`status` is `todo | done` only.** The legacy enum had `updated` and `overdue` too; nothing ever
  set them. Overdue is derived from `dueDate`, not stored.
- Timestamps are stored UTC. Each workspace gets a timezone (see §6) — "due today" and quiet hours are
  meaningless without one.
- `sortOrder` on Floor and Room so the layout can be arranged. The legacy app had insertion order and
  no way to change it.

## 4. Feature specs

### 4.1 Assignees

Tasks gain assignees: **zero, one, or many** users, drawn from the members of the task's workspace.

- Unassigned is a valid, first-class state meaning "whoever gets to it" — not missing data. It must
  never render as an error or an empty slot demanding to be filled.
- Assignment is its own endpoint (`POST`/`DELETE /api/tasks/:id/assignees`), not a generic field
  update, so it can be notified on and recorded with who assigned whom.
- Removing a member from a workspace removes their assignments in that workspace.
- The task list gains an assignee filter, combinable with the room/floor/search scope:
  *Anyone* (default) · *Mine* · *Unassigned* · *specific members* (multi-select).
- Filter state lives in the URL query string so a filtered view is linkable and survives reload.
- Cards show assignee avatars, with an initials fallback.

### 4.2 Authentication — email + password only

Google OAuth is gone. No social login, no OAuth plumbing, no provider credentials in shell scripts.

- Register with email + password. Password hashed with argon2id.
- Email verification is mandatory before login succeeds. **In development, verification and reset
  links are printed to the server console** — no SMTP server, no Mailpit container. Production uses
  one transactional email provider behind a single `sendMail()` function.
- Sessions are opaque random ids in a `Session` row, delivered as an `httpOnly`, `sameSite=lax`,
  `secure`-in-production cookie. No JWTs. Logout deletes the row; logging out everywhere deletes all
  rows for the user.
- Password reset by emailed single-use token.
- Rate-limit login, register, and reset-request by IP and by email.
- Avatars are uploaded files (the Google profile-picture import is gone). Ship an initials avatar so
  a user without one never looks broken.
- Migration concern if legacy data is carried over: Google-only accounts have no usable password and
  must be pushed through a reset. See §6.

### 4.3 Notifications

Two delivery paths, because they have different requirements.

**In-app (tab open).** Events arrive over the SSE channel that already drives the task list and
surface as a toast plus an unread badge. No extra infrastructure, and it works even if the user
refuses push permission.

**Web Push (tab closed).** Service Worker + VAPID. Required for anything time-based — a deadline
reminder that only fires while the app is open is worthless.

| Event | Trigger | Recipients |
|---|---|---|
| `assigned` | someone adds you to a task | the newly assigned user |
| `due_soon` | `dueDate` minus the user's lead time | assignees, or all members if unassigned |
| `overdue` | `dueDate` passes, task not done | assignees, or all members if unassigned |
| `completed_by_other` | a task you're assigned to is completed by someone else | the other assignees |

Requirements:

- Permission is requested **contextually** — when the user first enables notifications in settings.
  Never on page load.
- Per-user preferences (`NotifyPreference`): master switch, per-event toggles, `due_soon` lead time,
  quiet hours. Quiet hours suppress push, not the in-app feed.
- Time-based events come from a single scheduler tick — a `setInterval` in the server process, every
  few minutes. No broker, no worker, no cron container.
- **Delivery must be idempotent.** Write a `NotifyLog` row per (user, task, kind) and check it before
  sending, or the scheduler re-sends the same reminder on every tick. This is the single most likely
  bug in the whole feature.
- Every notification deep-links to the task. The Service Worker click handler focuses an existing tab
  if one is open rather than opening a new one.
- Expired/rejected push subscriptions (410/404 from the push service) are deleted on the spot.
- Notifications are strictly additive. If push is denied, unsupported, or broken, the app behaves
  exactly as it would without it.

### 4.4 Live updates — replacing the polling ping

You remembered this correctly: the legacy app polls every 10 seconds for `max(modified_date)` across
the tasks in view, and if that value moved it refetches the full pending list *and* the full completed
list, then hand-diffs the DOM card by card against timestamps stashed in hidden `display:none` spans.
About six requests a minute per open tab, plus an extra round trip on every write.

It works, and the flash-on-change animation is genuinely nice — keep that. But it can only detect
*that* something changed, never *what*, so every change costs two full list fetches; two edits inside
one interval collapse into one; and it can't see a change that doesn't raise the maximum timestamp.

**Replacement: Server-Sent Events.** `GET /api/events` holds one long-lived response per client.
The server pushes `task.created` · `task.updated` · `task.deleted` · `task.assigned` ·
`floor.*` · `room.*`, each carrying the changed entity.

- One SSE hub in `apps/server/src/events/`: a map of workspaceId → set of subscribers. Publishing
  fans out to that workspace only.
- Events carry the acting user's id so a client can skip echoing back its own change.
- On the client, one `useEventStream` hook writes incoming entities straight into the TanStack Query
  cache. `EventSource` reconnects on its own; on reconnect, refetch the current view once to close
  any gap.
- Send a periodic comment line as a keepalive so intermediaries don't drop the connection.
- SSE is one-directional and rides plain HTTP — all writes stay ordinary `POST`/`PATCH` requests.
  WebSockets would work but buy nothing here, since nothing needs a client→server stream.

Two things change regardless of transport, and they're the real win:

- **Reconciliation stops being manual.** Tasks live in client state keyed by id. The entire
  diff-the-DOM-against-hidden-spans machinery — the largest and worst part of the legacy frontend —
  simply does not exist.
- **Edits are optimistic with rollback**, instead of writing, waiting 200ms, and hoping the next poll
  agrees.

## 5. Product additions

These came out of reviewing the legacy app. §5.1 and §5.2 are the ones that matter.

### 5.1 The completion log (do this early)

`TaskCompletion` — one append-only row per completion: task, who, when. It is three columns and it
unlocks four separate features:

- **Recurrence** needs to know when a task was last done.
- **Fairness stats** (§5.3) need to know who did what.
- **Room staleness** (§5.4) needs "nothing here has been done in 12 days".
- **Notification idempotency** benefits from the same history.

The legacy app had a single `completed_date` that was overwritten on every completion and never
cleared when a recurring task was reset — so it both destroyed history and reported completions that
no longer held. Add this table with the first schema, not later; retrofitting history you never
recorded is impossible.

`Task.status` becomes derived-ish: a task is done if it has a completion newer than its current cycle
start. Keep the stored `status` column as a fast path, but the log is the truth.

### 5.2 Real recurrence

**This is the biggest functional gap in the legacy app — bigger than notifications.** "Vacuum every
two weeks" is the central chore use case, and today "recurring" only means a human can press a button
to reset it.

- `recurrenceEvery` + `recurrenceUnit` (`day | week | month`) on Task. Null means one-off.
- On completion, a recurring task's next due date is computed from the completion and the task returns
  to `todo`. Decide (§6) whether the next date anchors to the completion or to the previous due date —
  "every 2 weeks from when I actually did it" versus "every other Sunday" are both legitimate, and
  they diverge as soon as someone is late.
- The card shows "last done 3 days ago" from the completion log — far more useful than the legacy
  "modified 3 days ago".
- Keep manual reset-to-todo as an escape hatch.

### 5.3 Fairness and rotation

With assignees plus recurrence plus the completion log, this falls out almost free, and it's the
feature people would actually tell their flatmates about. Shared houses don't argue about *what* needs
doing — they argue about *who's been doing it*.

- `Task.rotateAssignees`: on completion of a recurring task, advance the assignee to the next person
  in the rotation instead of keeping them.
- A per-workspace tally: completions per person over the last week/month, from the completion log. One
  screen, no new schema.
- **Skip points, streaks, and badges.** Gamifying chores between people who live together tends to
  curdle. The honest tally provides the accountability without keeping score.

### 5.4 Room staleness

Room task-count badges already exist. With the completion log you can also surface *how long a room
has gone untouched* — "bathroom: nothing done in 12 days". This fits the floor-plan metaphor far
better than a list does and makes the home view answer the actual question, "what needs attention?"

### 5.5 Mobile-first PWA

In practice this app gets used standing in the kitchen with a phone. The rewrite is the moment to make
phone the primary target rather than a media query afterthought: large tap targets, thumb-reachable
primary actions, no hover-dependent affordances. A Service Worker is already going in for push, so
installability and an app icon are nearly free — and they make the notifications feel native.

### 5.6 Keep the visual identity

The spatial model is what makes this app different from every flat to-do list, and the emoji +
per-floor-colour language is its identity. The default gravity of any component library is to flatten
it into a generic board — resist that. In Tailwind the floor colour becomes a CSS custom property set
once per floor subtree, so the glow/tint effects are one variable instead of the legacy app's dozens
of inline gradients.

## 6. Open questions

Ask when you reach the step that depends on one. Do not assume.

1. **Existing production data.** There is a deployed Postgres with real households in it. Do we
   migrate it into SQLite (a one-off export/import script, plus forced password resets for Google-only
   accounts), or start clean? This changes whether the schema needs to accommodate legacy ids.

   > **ANSWERED (2026-07-27): start clean.** No legacy id columns anywhere in the schema, and no
   > export/import script. Existing households re-register. If this is ever revisited, note that the
   > schema has no space reserved for legacy ids — adding them later is a migration, not a no-op.

2. **Recurrence anchoring** — next due date from the completion, or from the previous due date? (§5.2)

   > **ANSWERED (2026-07-27): from the completion, by default.** Implemented as a per-task
   > `recurrenceAnchor` (`completion | dueDate`) defaulting to `completion`, because both behaviours
   > are legitimate and the column is cheap. `dueDate` mode keeps stepping until the result is in the
   > future, so a task completed five weeks late does not come back already overdue. Both paths, plus
   > the DST and short-month cases, are covered in `apps/server/src/test/recurrence.test.ts`.

3. **Workspace timezone** — per workspace, or per user? Affects "due today", overdue, and quiet hours.

   > **ANSWERED (2026-07-27): per workspace.** `Workspace.timezone`, so every member of a household
   > agrees on what "today" means. Quiet hours stay per-user, since those are about sleep. Note that
   > *overdue* turned out not to need a timezone at all — it is an instant comparison. The zone is
   > load-bearing for "due today", quiet hours, the fairness window, and stepping a recurrence across
   > a DST boundary.

4. **Workspace lifecycle.** The legacy app auto-created a workspace on first login and offered no way
   to create, rename, or delete one. Confirm the rewrite gets real workspace CRUD, and whether a user
   can belong to several (the legacy model allowed it and the UI half-supported it).

   > **ASSUMED, NOT CONFIRMED — please review.** Built as full CRUD with multi-workspace membership:
   > create/rename/delete (delete is owner-only), a user may belong to several, and belonging to *none*
   > is a normal state the UI handles with a create prompt rather than auto-creating one. There is no
   > auto-creation on login at all. This seemed strongly implied by §4.1 and by problem 10, but it was
   > not explicitly confirmed.

5. **Invitations.** Legacy could only add an existing account by exact email. Do we want emailed
   invite links with a pending state?

   > **STILL OPEN — legacy behaviour shipped as the interim.** `POST /api/workspaces/:id/members`
   > takes an email and requires that the account already exist; an unknown address is a 400 worded so
   > it is not an account-existence oracle. The settings UI says as much. Emailed invite links with a
   > pending state would need an `Invite` table and a token flow — not built.

6. **Scope for v1 of the rewrite** — is it feature parity plus assignees, with recurrence and
   notifications following? Or is recurrence in from the start? (§5.2 argues it's the highest-value
   addition, and it's cheap once the completion log exists.)

   > **RESOLVED BY THE HANDOFF ORDER: everything.** Steps 1–10 of the handoff already sequence
   > recurrence at 8 and notifications at 9, so all of it is in. Recurrence was indeed cheap once
   > `TaskCompletion` existed.

## 7. Dev commands (rewrite)

Native. No Docker.

```bash
pnpm install
pnpm db:migrate           # prisma migrate dev
pnpm db:seed              # a plausible two-floor house with a few users
pnpm db:studio            # prisma studio, for poking at data

pnpm dev                  # server (tsx watch, :3001) + web (vite, :5173) together
                          # vite proxies /api -> :3001

pnpm test                 # vitest
pnpm check                # biome lint + format
pnpm build                # tsc + vite build; server then serves web/dist in production

./scripts/server.sh start # run api and/or web detached; also stop|restart|status|logs|health
```

One deviation from the line above, worth knowing: **`pnpm build` typechecks but does not emit server
JavaScript.** `packages/shared` is consumed as TypeScript source so that it stays the single
definition of every API shape; compiling the server separately would mean either building `shared`
twice or emitting an import that cannot resolve at runtime. So the server runs through `tsx` in
production too (esbuild transpile-on-load), and `tsc --noEmit` is the gate that fails the build.

Setup notes:

- Node 22+ and pnpm on the host. Nothing else needs installing — no database service, no mail server,
  no Redis.
- SQLite lives at `data/app.db` (gitignored). Deleting it and re-running `db:migrate && db:seed` is
  the reset button.
- Env vars validated by Zod at boot in `apps/server/src/env.ts`; `.env.example` is committed and stays
  in sync.
- Web Push in dev: generate keys once with `npx web-push generate-vapid-keys` into `.env`. Push works
  on `localhost` without HTTPS.
- Verification and password-reset links are printed to the server console in development.
- The `Dockerfile` is a multi-stage build producing a single image (build web → build server → run
  Fastify serving both, with `data/` as a volume). **Write it; do not build or run it.**

---

# PART 2 — THE LEGACY DJANGO APP

Reference material. This is the requirements baseline — what the rewrite must match, or deliberately
change. When a behavioural question is genuinely ambiguous, the Django source on `main` is the
tiebreaker.

## Legacy stack

Django 4.2 / Python 3.12, cookiecutter-django layout. PostgreSQL. django-allauth (email + Google
OAuth). Server-rendered Django templates + Bootstrap 5.3 from CDN, dark theme only. Frontend is plain
non-module JavaScript: `project.js` (webpack-bundled) and `tasks_partial.js` (a raw `<script src>`
defining globals). emoji-mart from CDN. Live updates by polling. Redis provisioned in production and
effectively unused. Docker Compose deploy behind Traefik + nginx, whitenoise for static.

Key files: `tracker/task/{models,views,urls}.py`, `tracker/users/adapters.py` (workspace
auto-creation), `tracker/templates/partials/_tasks.html` (the task card template),
`tracker/static/js/tasks_partial.js` (the 1300-line polling/DOM-diff engine),
`config/settings/base.py`.

`manage.py` and `config/wsgi.py` append `tracker/` to `sys.path`, which is why `config/urls.py` can
`include("task.urls")` and why models declare `app_label = "task"` explicitly.

## Legacy domain model

```
User (email login, no username, optional avatar, default_workspace FK)
  └── M2M workspaces
Workspace (name, users M2M, created_by FK)
  └── Floor (name, icon: emoji, color: hex, default #8A2BE2)
        └── Room (name, icon: emoji)
              └── M2M tasks
Task (task_name, task_description, status, type, category,
      due_date, creation_date, modified_date, completed_date, deleted_date,
      rooms M2M)
```

- `status`: `to_do | updated | overdue | done` — only `to_do` and `done` are ever used.
- `type`: `single | recurring` — "recurring" only means *resettable to to-do by hand*. No schedule.
- `category`: `urgent | normal | special` — drives sort order and card styling only.
- **No owner, no assignee, no attribution.** **No direct Task→Workspace link** (inferred via
  `rooms → floor → workspace`). Tasks soft-delete; floors and rooms hard-delete with cascade.

## Legacy functional spec

### Accounts & onboarding

- Sign up with email+password (mandatory verification) or Google OAuth. Email is the login field;
  `name` is a free-text display name; avatar optional, imported from Google on first social login.
- **On every login**, if the user has no `default_workspace`, one is created named
  `"<email>'s Workspace"` with them as sole member. Login also writes `selected_workspace_id` and a
  denormalised `sidebar_floors` snapshot into the session.
- Profile page edits avatar, display name, and default workspace (limited to their workspaces).

### Workspaces

- A workspace is a household: name, creator, member users.
- **Cannot be created, renamed, or deleted from the UI** — auto-creation on login is the only path.
- `/task/workspaces/` lets a user pick the **current** workspace (session-scoped), pick the
  **default** (persisted on the user), see who has access, and — if they're the creator — add a member
  by email or remove one. The invitee must already have an account; there are no invitations.
- Everything else is scoped to `request.session["selected_workspace_id"]`.

### Floors & rooms (index page, `/`)

- Floors as cards, three per row, each tinted with its colour (gradient header, glow accents).
- Per floor: emoji, name (links to floor view), inline edit form (name, colour picker, emoji picker),
  delete with `confirm()`.
- Per room: emoji, name (links to room view), badge with count of not-done tasks, inline edit form
  (name, emoji), delete.
- "+ Floor" / "+ Room" reveal inline forms; emoji fields use emoji-mart in a centred modal. All
  mutations are form POSTs that redirect back to the index.
- Empty workspace shows a prompt and a pulsing "+ Floor" button; if the user has several workspaces it
  also lists them and links to the switcher.

### Task list views

Three views share one partial and one script:

| View | URL | Which tasks |
|---|---|---|
| Room | `/task/room/<id>` | tasks assigned to that room |
| Floor | `/task/floor/<id>` | tasks assigned to **every** room on that floor |
| Search | `/task/search_tasks/<term>` | name or description contains the term, current workspace |

Each renders **Pending** (top) and **Completed** (bottom), with skeleton cards during the first fetch.
No pending tasks → a "Congratulations!" banner. Nothing completed → "No tasks completed yet".

Pending order: `urgent` → `special` → `normal`, then most-recently-modified first.
Completed set: all done *recurring* tasks, plus the 20 most recently modified done *one-time* tasks.

### Task cards

Rendered client-side from a `<template>`. Collapsed: name (click-to-edit `contenteditable`),
description (click-to-edit), green ✓ mark-done (pending only; confirms unless recurring), blue ↻
mark-to-do (done + recurring only), relative due chip ("3 days", "2 hours ago") with "late" styling
when overdue, ↻ badge if recurring, ✓ badge if done, and category styling (urgent/special get a
coloured glow and printed label).

Expanded: last-modified relative time, type dropdown, category dropdown, deadline picker + eraser to
clear, assigned rooms each with a remove ✕, a "+" opening a room-attach modal, and Delete.

**Every control saves immediately** — no Save button, no dirty state. Each edit is one
`POST /task/update_task/` with `{task_id, field_name, value}`. Marking done sets `completed_date` and
moves the card to Completed; resetting a recurring task moves it back but does **not** clear
`completed_date`.

### Creating a task

Sidebar "New task" opens a modal: name (required, ≤128), description (**required in the form** though
the model allows blank, ≤512), optional deadline, regularity, category, and a room picker. The picker
is an accordion of floors; ticking a floor ticks all its rooms and vice versa, with an indeterminate
state when partial. Opened from a room or floor view, the relevant boxes are pre-checked. No rooms
selected → inline error, no submit. Submit is AJAX; the modal closes and the task appears on the next
poll.

### Sidebar

Avatar + display name with a dropdown (Home, Workspaces, Profile, Sign out); "New task" button; the
floor/room tree with each floor glowing in its own colour, per-floor collapse state in a cookie, and
the active floor/room highlighted. Collapsible; below 630px it becomes a full-screen overlay and locks
body scroll. **The tree reads from `session["sidebar_floors"]`** — a snapshot written at login and
refreshed by the index view and workspace switch, not queried live.

### Live updates

No push. Two loops in `tasks_partial.js`: every 10s `GET /task/fetch_latest_task_timestamp` returns
`max(modified_date)` in scope; if it changed, the client refetches pending and completed as two
separate requests. Reconciliation is manual DOM diffing — each card stores the server's
`modified_date` in a hidden `.debug` span; if it differs the fields are rewritten in place and the card
flashes. New tasks are appended; tasks absent from the response are removed. Every local edit also
triggers an immediate poll. Baseline ~6 requests/minute per tab.

### Other

`/about/`. Contextual help buttons opening Bootstrap accordions with screenshots from
`tracker/static/images/`. Django admin at `/admin/` with all four task models registered.

## Legacy HTTP surface

All require login; all under `/task/` except the index.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | workspace overview (index) |
| GET | `/task/floor/<id>`, `/task/room/<id>`, `/task/search_tasks/<term>` | task views (HTML) |
| GET | `/task/workspaces/` | workspace management |
| GET | `/task/fetch_tasks/?floor_id=\|room_id=\|search=&completed=` | task list JSON |
| GET | `/task/fetch_latest_task_timestamp/?…` | change detection |
| POST | `/task/tasks/create/` | create task (form-encoded) |
| POST | `/task/update_task/` | single-field update (JSON) |
| POST | `/task/delete_task/` | soft delete (JSON) |
| POST | `/task/add_floor/`, `/task/edit_floor/<id>`, `/task/remove_floor/<id>/` | floor CRUD |
| POST | `/task/add_room/`, `/task/edit_room/<id>`, `/task/remove_room/<id>` | room CRUD |
| POST | `/task/set_workspace/`, `/task/set_default_workspace/` | workspace selection |
| POST | `/task/add_user_to_workspace/`, `/task/remove_user_from_workspace/` | membership |

`update_task` accepts `field_name` ∈ {`task_name`, `task_description`, `status`, `type`, `category`,
`due_date`, `description`, `room_remove`, `room_add`}. `description` isn't a model field and silently
does nothing.

## Legacy known problems

Kept because each one is a trap the rewrite must not reproduce. Ordered roughly by severity.

### Security / authorization

1. **IDOR on task creation** — `Room.objects.get(id=room_id)` with no ownership check, so a crafted
   `roomIDs` list creates tasks in anyone's rooms (`views.py:464`).
2. **IDOR on `room_add`** — same in `update_task`; a task can be attached to rooms in another
   workspace (`views.py:531`).
3. **`room()` / `floor()` views don't check ownership** — any logged-in user can load any room or
   floor page and see its name and emoji. Task data itself is scoped, so this leaks metadata only.
4. **`task_belongs_to_workspace` only inspects the first room** and raises `IndexError` on a task with
   zero rooms (`views.py:704`), which is reachable by removing rooms one at a time.
5. **Membership endpoints ignore which workspace** — `Workspace.objects.get(created_by=request.user)`
   raises `MultipleObjectsReturned` for anyone who created two, and 500s on an unknown email.
6. **No enum validation** in `update_task`; `status`/`type`/`category` are `setattr`'d from the request
   body, and length limits aren't enforced (Django doesn't validate on `save()`).
7. `write_to_log()` appends to `ivan_log.txt` in the process CWD on every update and every search —
   debug logging left in deployed code (`views.py:713`).

### Correctness / data integrity

8. **Floor view means "in *all* rooms on this floor"**, via a `.filter()` per room in a loop
   (`views.py:222`). Add a room later and existing floor-wide tasks silently vanish. The rewrite
   should use union-of-rooms, which is what users expect.
9. **Deleting a floor or room hard-cascades**, dropping M2M rows; tasks only in that room become
   invisible forever and crash the workspace check.
10. **`index` assumes a valid workspace in the session** — raises on a fresh session, a cleared
    session, or a workspace the user was removed from (`views.py:40`). Same in `wokspaces_view`
    (whose name is also misspelled).
11. **Search hardcodes `http://`** and always appends `:` + port (`project.js:27`), so on the HTTPS
    production site search downgrades the scheme and builds a malformed host.
12. **Room badge counts soft-deleted tasks** — `count_not_done` excludes `status="done"` but not
    `deleted_date`.
13. **Search doesn't exclude soft-deleted tasks server-side**; the client hides them on first render
    but the reconciliation path doesn't, so they linger.
14. `completed_date` is never cleared when a recurring task is reset — it reports a completion that no
    longer holds.
15. Recurring tasks carry no history; resetting one destroys the previous completion.
16. Due dates are naive midnight coerced to UTC, and "overdue" is decided in the browser by checking
    whether a formatted string contains `"ago"` (`tasks_partial.js:279`).
17. `sidebar_floors` in the session is a stale denormalised copy, and the login adapter's version omits
    room icons — so the sidebar renders differently right after login than after a workspace switch.
    The query is duplicated in `adapters.py` and `views.set_sidebar_floors`.
18. Marking done moves the card optimistically with a `setTimeout(200)` racing the server round-trip.

### Architecture

19. **State lives in the DOM** — hidden `.debug` spans hold server timestamps, diffed as strings to
    decide what to re-render (`tasks_partial.js:99`). The single biggest reason the frontend resists
    change.
20. `tasks_partial.js` is 1300 lines of globals, with `has-event-listener="true"` attributes as a
    hand-rolled guard against double-binding.
21. `updateTasksOnPage` repeats a near-identical ~25-line block three times, once per category.
22. No API layer — hand-built dicts, no serializers, no schema. `rooms` is an object keyed by id, and
    two call sites render its value as if it were a string rather than `{name, icon}`.
23. CSRF tokens stamped into dozens of individual DOM attributes.
24. Presentation scattered across four CSS files, in-template `<style>` blocks, and hundreds of inline
    `style=` attributes with hardcoded colours.
25. Bootstrap and emoji-mart from CDN while everything else is webpacked — two build stories.
26. **Zero tests for the app.** `tracker/task/tests.py` is the empty stub; only cookiecutter's `users`
    tests exist, so CI passes while covering nothing.
27. `task_modal.js` is 0 bytes; `vendors.js` is 2 lines.
28. Redis provisioned in production, unused.
29. Typo'd setting: `CIALACCOUNT_AUTO_SIGNUP = False` never takes effect
    (`config/settings/base.py:286`).
30. `sys.path` manipulation plus manual `app_label` is a non-standard layout that confuses tooling not
    run through `manage.py`.

### Product gaps (all addressed in Part 1)

31. No workspace create/rename/delete. 32. No invitations. 33. No assignment or attribution.
34. No true recurrence. 35. No notifications despite due dates existing. 36. No filtering or sorting
controls. 37. Completed list capped at 20 with no history view. 38. No bulk operations, no undo.
39. Accessibility not considered — `contenteditable` as form fields, `confirm()` dialogs, colour-only
status signalling, emoji as meaningful content without labels.

## Legacy dev commands

For reference only; the rewrite runs natively per §7.

```bash
./run_dev.sh                                                   # docker compose -f local.yml up
docker compose -f local.yml run --rm django python manage.py migrate
docker compose -f local.yml run django pytest
./deploy_prod.sh [--rebuild]                                   # production.yml
```

`run_dev.sh` / `deploy_prod.sh` read Google OAuth credentials from `./api_credentials/` (not in the
repo). Environment config in `.envs/.local/` and `.envs/.production/`.
