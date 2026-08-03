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
- **A comment is not editable, and reactions live on comments only.** A note records one occasion, so
  there is no edit state, no "edited" marker and no second event type — the author can delete theirs.
  Reactions never go on a task or a completion: a 👍 on a chore someone finished is scorekeeping, which
  this app deliberately does not do. Reactions notify nobody and never touch `NotifyLog`.
- **The description says what the chore *is*; a note says what happened.** Never fold one into the
  other — the second kind of note used to survive exactly until someone tidied up the first.
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
- **Nothing per-viewer goes in an event payload.** `hub.publish` serialises one object for every
  subscriber in the workspace, so a field that answers "for *you*" would be broadcast with one
  person's answer. That is why `comment.*` events carry `{ id, taskId }` rather than the comment,
  which has `canDelete` and `mine`: receivers refetch the thread instead. Acting on an *id* from the
  payload is still fine — `comment.deleted` prunes the cached thread by id, and has to; see Live
  updates for why an invalidate alone is not enough there.
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
  One known hole in that, because it looks like a variant bug and is not: the base rule for native
  controls (`input, select, textarea, button { color: inherit }`) is **unlayered**, and unlayered
  declarations outrank every `@layer`, so a variant's own `color` never reaches a `<button>` —
  `icon-btn-primary` sets `color: #fff` and its glyph still comes out `--color-text`. Colour the
  `Icon` instead, where nothing is competing.
- **Icons are the inline SVG set in `components/Icon.tsx`** — `currentColor`, `aria-hidden`, and
  never the only label on a control. Emoji stay for the things a *user* chose: floor and room icons.
- Phone is the primary target: 44px minimum tap targets (the `tap` utility), thumb-reachable primary
  actions, no hover-dependent affordances.

**Links to a task**

- **A task's URL is one shape, and `lib/share.ts` is where it is built.** Everything that can send
  someone to a task goes through `taskPath` — the share button, the notification feed. The push
  payload builds the same path by hand on the server, because the two cannot import each other, and
  both say so.
- **It is canonical, never contextual.** No filters, and not the page the sharer happened to be on.
  A recipient lands on the task in the full list, not inside someone else's search for "kettle".
- **The page resolves the linked task *by id*, never by hoping it is in the list.** This is the whole
  feature: a room filter, `status=done` or the list's own limit can each mean the task is not in the
  response the page renders, and then the link silently does nothing. `?task=` used to mean no more
  than "expand that card if it is on screen", which is why tapping a notification so often appeared
  to do nothing at all.
- **A pinned task is not rendered twice.** Two cards for one chore is two independent expanded
  states, so the lists skip whatever the spotlight is showing.

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
      spa.ts                # serving the built client + the SPA fallback (production)
      env.ts                # Zod-validated process.env
      db.ts                 # Prisma client singleton
      auth/                 # password hashing, sessions, tokens, middleware
      routes/               # one file per resource: auth, me, workspaces, layout,
                            #   tasks, comments, events (SSE), notifications
      services/             # business logic — tasks, comments, layout, recurrence,
                            #   notifications, push, mail, time, workspaces, serialize
      events/hub.ts         # SSE hub: per-workspace subscriber registry
      jobs/scheduler.ts     # the scheduler tick
      lib/                  # HttpError, request validation
      test/
    prisma/                 # schema.prisma, migrations/, seed.ts
  web/
    src/
      main.tsx, App.tsx     # routing and the workspace shell
      routes/               # one file per page
      components/           # Shell, TaskCard, TaskSpotlight, ShareTaskButton,
                            #   CommentThread, NewTaskDialog, Avatar, Icon,
                            #   InlineText, ThemeToggle
      features/             # tasks/, comments/, layout/, session/, stats/, notifications/
                            #   — hooks per domain
      lib/                  # api client, useEventStream, useTheme, lastWorkspace,
                            #   share (the one task URL), formatting, query keys
    public/sw.js            # service worker (push handling)
packages/
  shared/src/
    schemas/                # Zod schemas — the API contract
    constants.ts            # enums, limits, defaults
data/app.db                 # gitignored
uploads/                    # avatars, gitignored
Dockerfile                  # written, image never built
```

Client routes, all under a workspace (`/w/:workspaceId`):

| Route | Page |
|---|---|
| `/` | **Dashboard** — yours, then up-for-grabs, then the house at a glance |
| `/house` | the floor plan, and the only place floors and rooms are edited |
| `/tasks` | one list, filtered by room, floor, search and assignee via the query string |
| `/settings` | fairness tally, appearance, household, notifications, profile |

`/tasks?task=<id>` is additionally **the** URL for one task — where a shared link and a notification
land. It is not a filter: the list renders exactly as it would without it and the named task is
pinned above it. See *Sharing a task* below.

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
TaskComment     id, taskId, authorId?, body, createdAt     # not editable
CommentReaction commentId, userId, emoji                   # composite PK is the toggle

PushSubscription  id, userId, endpoint (unique), p256dh, auth
NotifyPreference  userId (PK), enabled, onAssigned, onDueSoon, onOverdue,
                  onCompletedByOther, onCommented, dueSoonLeadHours,
                  quietFrom?, quietTo?
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
  once and then never again — which is the bug you get from fixing re-delivery carelessly. For
  `commented` the cycle key is the comment's own id, which is the cleanest fit in the table: every
  note is genuinely its own occurrence, so a retry cannot double-send and the next note is never
  suppressed.
- **`TaskComment` has no `updatedAt`**, because a note is not editable. `authorId` is `SetNull` like
  `completedById`: a departed housemate's note is still the reason a chore is done the way it is.
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
| GET/POST | `/api/tasks/:id/comments` | the thread, oldest first; post a note |
| DELETE | `/api/comments/:commentId` | author only, hard delete |
| POST | `/api/comments/:commentId/reactions` | toggle one reaction |
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

**`/` lands on the household you were last in**, remembered per device in `lib/lastWorkspace.ts` — the
same kind of setting as the theme, and for the same reason it is not on the server. It is only ever a
*hint*: `landingWorkspace` resolves it against `me.workspaces` and falls back to the first, so a
household you were removed from degrades to landing somewhere sensible. That distinction is the whole
point. The legacy app kept the current workspace in the session and treated it as the answer, which is
why a cleared cookie or a revoked membership crashed its index view. It is written from "you are
looking at this one" rather than from the switcher, so a shared link or a notification that lands you
somewhere is also what you come back to.

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

An expanded card edits **everything** a task has: name, description, category, deadline, assignees,
rooms and recurrence. Rooms and recurrence were the gap that made this worth stating — the endpoints
and the `useAttachRoom` hook existed while nothing on a card ever called them, so a room could be
detached and never put back, and a task's cadence was fixed at creation. Recurrence sends `every` and
`unit` together, because the schema rejects one without the other.

### Assignees and filtering

Assignment is its own endpoint rather than a generic field update, so it can be notified on and
recorded with who assigned whom. The task list filters by room, floor, search and assignee
(*Anyone* · *Mine* · *Unassigned* · specific members), all combinable, all in the URL query string so
a filtered view is linkable and survives reload.

### Sharing a task

A link icon on every card, beside the expand chevron. It hands over
`/w/:workspaceId/tasks?task=<taskId>` — the OS share sheet where `navigator.share` exists, the
clipboard otherwise. Always visible rather than inside the expanded block, because passing a chore to
someone is a thing you do while scanning a list.

Both of those APIs need a secure context, and this app is routinely opened over plain http on a LAN
(`EXPOSE=1`, any deployment without TLS) — which is the phone, which is where sharing happens. So the
third path is real, not theoretical: the URL is shown in a field, selected, for the user to copy by
hand. Anything that silently did nothing there would fail exactly where the feature is most used.

**Where the link lands** is `TaskSpotlight`, above the list: the task fetched by id, marked, expanded,
scrolled to, and skipped by the lists below so there is only ever one card for it. Three things follow
from it being a *pin* rather than a page:

- The list is still underneath, so "what else needs doing" is one scroll away. That is the point of an
  app made of cards rather than a stack of detail pages, and a dedicated `/task/:id` route would have
  been a second place a task is rendered.
- The state is escapable and explained. A band says why the card is up there and its dismiss clears
  `?task=` — nobody is left with a highlighted card and no idea what did it. Clearing the *filters*
  deliberately keeps the pin, since widening a search is not the same as putting down what someone
  sent you.
- A stale link says so. A deleted task and a task from a household you are not in both answer 404 by
  design, so there is one honest message for both rather than a guess. A task from a household you
  *are* in but not the one in the path is the odd case worth handling separately — the card would
  otherwise render over the wrong house's list — so it offers the URL that works instead.

The marker is `spotlight` in `index.css`: an outline and a glow, one pulse on arrival then settled.
`outline` rather than `border-color`, because a card already spends its border on the category edge
and that would be a same-specificity fight decided by stylesheet order. The scroll margin lives on the
section that `scrollIntoView` is called on, or the sticky header eats the band and the task's name.

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

### Notes and reactions

A thread of comments on a task, for the thing a description is the wrong home for: the description
defines the chore, a note records one occasion — "it was properly furred up this time, maybe make this
monthly". Before this existed the only place for the second kind was the description, where the next
person to tidy up the wording destroyed it.

- **Oldest first**, unlike every other list in the app, because a thread reads as a conversation and
  the newest note belongs next to the composer.
- **Not editable.** The author can delete their own; nobody else can, and the refusal is a 404 so
  there is one answer for "you cannot have this".
- **Always on the card, expanded or not.** A note is the one part of a task another person wrote *to
  be read*, and behind an expand nobody read it — which pushes the second kind of note back into the
  description, the exact failure the thread exists to prevent. There is no comment-count chip any
  more: a number standing in for the notes is a worse copy of what is now a few lines below it.
- **`commentCount` rides on the task, the bodies do not.** The dashboard feeds all of its sections from
  one `status=todo` query, and putting comment text in that response would bloat the app's hottest
  request. That count is now also what *gates the fetch*: a task with no notes asks for no thread, so
  nine cards where one has notes make one request, not nine. Because the count lives on the task and
  refetches separately, it lags a beat behind a write — so the add and delete mutations patch the
  thread cache themselves, and `comment.deleted` prunes by id over SSE, rather than relying on an
  invalidate that a disabled query would ignore.
- **The composer stays one button until tapped**, so a list of cards is not a column of empty text
  boxes. That is what makes "always visible" affordable in layout as well as in requests.
- **Reactions are a closed set** (`COMMENT_REACTIONS`) on comments only, one emoji per person per
  comment, toggling. Optimistic on the client, since a reaction is a tap that has to feel instant.
- Writing a note notifies the people already involved — assignees, the task's creator, anyone who has
  commented before — minus the author. Deliberately *not* the whole household when a task is
  unassigned, which is what `due_soon` and `overdue` do: a deadline is worth waking everyone for, and
  notes arrive far more often. Whoever claims the chore reads the thread then.
- A note is also the reason edits stay silent. Someone chose to write it, whereas a description edit is
  usually janitorial, so this is the event worth a notification.

### Fairness and rotation

`Task.rotateAssignees`: on completion of a recurring task, advance to the next person in the rotation
instead of keeping the current assignee. Alongside it, a per-workspace tally of completions per
person over the last week or month, evaluated in the workspace timezone.

Deliberately a plain count: **no points, no streaks, no badges.** Gamifying chores between people who
live together tends to curdle; an honest tally provides the accountability without keeping score.

### Live updates

`GET /api/events` holds one long-lived response per client. The hub in `events/hub.ts` is a map of
workspaceId → subscribers, so publishing fans out to that workspace only.

Event types are `task.created|updated|deleted|assigned|unassigned`,
`comment.created|updated|deleted`, `floor.*`, `room.*`, `member.added|removed`, and `notification`.
Each envelope carries `id`, `type`, `workspaceId`, `actorId`, `at` and the changed entity — so
`useEventStream` writes it straight into the query cache by id, and a client can skip echoing back its
own change, which is what keeps optimistic updates from flickering.

The `comment.*` events are the exception, and the reason is worth knowing: they carry `{ id, taskId }`
instead of the comment, because `Comment` has two per-viewer fields (`canDelete`, `mine`) and one
serialised payload goes to every subscriber in the workspace. Receivers invalidate the thread rather
than writing the payload into it. `comment.updated` is a reaction changing.

`comment.deleted` additionally *prunes the cached thread by id*, and that is not belt-and-braces. The
thread's fetch is gated on the task's `commentCount`, so deleting the only note on a task takes that
count to 0 and stops the query being fetched at all — an invalidate alone would mark it stale, refetch
nothing, and leave the deleted note on screen. Pruning by id stays within the rule: an id is not a
per-viewer answer.

`EventSource` reconnects on its own; on reconnect the current view refetches once to close the gap. A
comment line every 25s keeps intermediaries from dropping the connection.

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
| `commented` | someone writes a note on a task | assignees, its creator, prior commenters — not the author |

- **Every notification is a way into the task it is about.** The feed entry and the push payload both
  point at `/w/:id/tasks?task=<id>`, and tapping a feed entry also marks *that one* read (`POST
  /api/notifications/:id/read`) and closes the bell. The route existed and nothing called it, so the
  only way to clear the badge was "mark all read" — acting on one notification left the badge
  unmoved, which is half of why the feed felt inert. The other half was landing on a page where
  nothing visibly happened; see *Sharing a task*.
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
- **Notes are comments, and reactions go on the notes.** A reaction on a *chore* is ambiguous (good
  job? yes do this? agreed?) and edges into the scorekeeping this app refuses; on a note it is the
  understood thing — "seen, thanks" — which lets someone acknowledge without adding another line. Left
  open on purpose: reacting to a *completion* is the obvious next request, and it is the one that would
  need this decision revisited rather than extended.
- **No comment editing.** Delete and retype. Editing would add a state to render, an "edited" marker to
  argue about, and a second event type, for a household thread where retyping costs nothing.
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
and length validation. The comment tests pin the parts most likely to rot: that `canDelete` differs by
viewer, that every comment route answers 404 across a workspace boundary, that a reaction toggles
instead of duplicating and an emptied group disappears, that a note notifies the participants and never
its author, and that the task list carries a count but no comment text.
`src/test/recurrence.test.ts` covers both anchors, DST and short months.
Notification idempotency is exercised by running the scheduler tick repeatedly and asserting nothing
sends twice.

`src/test/spa.test.ts` covers serving the built client, and exists because that branch shipped
answering **500 for every client route**: both `@fastify/static` registrations passed
`decorateReply: false`, so the fallback called a `reply.sendFile` that had never been added. Nothing
caught it, for two compounding reasons — the branch is gated on `isProduction`, so the API tests never
registered it, and in development the browser talks to Vite, whose own SPA fallback answers a reload
before Fastify sees it. The one URL a person checks by hand is `/`, which the static plugin serves
itself without reaching the fallback. **So a bug here is invisible both in the test suite and in
`pnpm dev`, and only appears in production.** That is why the logic lives in `src/spa.ts` — registered
onto a bare Fastify against a fixture directory, with no `NODE_ENV` to fake. The tests pin that a deep
route with a query string returns the shell with a 200, that a missing `/assets/*.js` returns a JSON
404 rather than HTML for the browser to parse as JavaScript, and that a non-GET is still a real 404.

---

## Deployment

`Dockerfile` is a multi-stage build producing a single image: build the client, install production
dependencies, run one Fastify process serving both, with `data/` and `uploads/` as volumes.

**The image has never been built.** It was authored as a reviewable artifact rather than part of the
dev loop, so treat its versions and paths as unverified until someone actually builds it.

The *serving* half of it is no longer unverified, and the way it was verified is worth keeping: build
the client, then boot the server natively with `NODE_ENV=production` against a scratch database and
reload a deep route.

```bash
pnpm --filter @task-tracker/web build
NODE_ENV=production PORT=3999 SESSION_SECRET=$(openssl rand -hex 32) \
  DATABASE_URL=file:data/scratch.db pnpm --filter @task-tracker/server exec tsx src/index.ts
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3999/w/any-id/tasks?roomId=x"   # want 200
```

`pnpm dev` cannot tell you anything about this — see the note under Tests on why the SPA fallback is
invisible outside production. Note also that the server boots happily against a database with no
schema; migrations are the container's `CMD`, not something the app does for itself.
