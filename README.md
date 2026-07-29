<div align="center">

# 🏡 Task Tracker

**Household chores, organised by the rooms they actually happen in.**

Not another flat to-do list. Tasks live in a *place* — so "what needs attention?"<br>
has an answer you can walk to.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-22_LTS-5FA04E?logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Prisma](https://img.shields.io/badge/Prisma-SQLite-2D3748?logo=prisma&logoColor=white)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

</div>

---

## The idea

A household is a **workspace**, and everything inside it hangs off the layout of the home:

```
Flat 4B — 3 housemates
│
├── 🏡 Ground floor
│   ├── 🍳 Kitchen — Deep clean the oven · nobody assigned, up for grabs
│   ├── 🛋️ Living room — Vacuum · Mira · every 2 weeks
│   ├── 🛁 Bathroom — Clean the bathroom · overdue
│   └── 🚪 Hallway — Take the bins out · shared with the Kitchen
│
└── 🛏️ Upstairs
    ├── 🛏️ Bedroom — Change the sheets · Mira · every 2 weeks
    ├── 📚 Study — Fix the wobbly shelf · done
    └── 🌿 Balcony — Water the plants · every 3 days
```

<sub>That's the seeded flat, verbatim — `pnpm db:seed` and you're looking at it.</sub>

Each room shows what's open and how long since anything there was done — *"nothing in 12 days"* — so
neglect is visible instead of buried in a list. A chore can span rooms, or belong to no room at all
(whole-flat jobs are normal), and it can belong to nobody, which means *whoever gets to it*.

## Highlights

- 🗓️ **Recurrence that isn't naive** — repeat from when it was *actually done*, or hold a fixed
  cadence regardless. DST and short months handled.
- ⚖️ **Fairness, not gamification** — an honest tally of who did what. No points, no streaks, no
  badges; keeping score between people who live together tends to curdle.
- 📝 **Notes, per occasion** — *"properly furred up this time, maybe make this monthly."* The
  description says what a chore **is**; a note says what **happened**.
- ⚡ **Live** — every change another housemate can see arrives over SSE. No polling, no refresh.
- 🔔 **Push that works with the tab closed** — deadlines and assignments, with quiet hours and
  per-event toggles. Denied permission degrades to in-app only; nothing breaks.
- 🌗 **Both themes are real** — light and dark, per device, stamped before first paint so there's no
  flash on load.
- 📱 **Phone first** — 44px tap targets, thumb-reachable actions, no hover-only affordances.
  Installable as a PWA.

## Quick start

Node 22+ and pnpm. **Nothing else** — no database service, no mail server, no Redis, no Docker.

```bash
pnpm install
pnpm db:migrate     # creates data/app.db
pnpm db:seed        # a two-floor flat, three housemates, plausible mess
pnpm dev            # API :3001 · client :5173
```

Open **<http://localhost:5173>** and sign in:

| Email | Password |
|---|---|
| `ivan@example.com` | `chores-are-fair` |
| `mira@example.com` | `chores-are-fair` |
| `deyan@example.com` | `chores-are-fair` |

No `.env` needed — every variable has a working default, and `.env.example` documents the rest.
Verification and password-reset links print to the server console, so there's no mail server to run.

> [!TIP]
> `data/app.db` is the entire database. Delete it and re-run `db:migrate && db:seed` to start over.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Both servers, watched. Vite proxies `/api` → :3001 |
| `pnpm test` | Vitest via Fastify `.inject()` — no socket, no port to collide with |
| `pnpm check` | Biome lint + format (`check:fix` writes) |
| `pnpm typecheck` | `tsc --noEmit` across all three packages |
| `pnpm build` | Typecheck, then build the client |
| `pnpm db:studio` · `db:reset` | Prisma tooling |

<details>
<summary><b>Running detached</b> — <code>start</code> · <code>stop</code> · <code>status</code> · <code>logs</code></summary>

<br>

`pnpm dev` runs in the foreground, which is what you want interactively. When you'd rather not hold a
terminal:

```bash
pnpm start:bg              # both, detached, waits until each answers
pnpm status                # what's up, on which port
pnpm logs api              # follow
pnpm restart web
pnpm stop
```

Targets are `api`, `web`, or `all`. Logs and pidfiles land in `.run/` (gitignored). The script refuses
to start on a port something else owns rather than fighting over it, and `stop` signals the whole
process group so watchers don't leak.

</details>

<details>
<summary><b>Reaching it from your phone or another machine</b></summary>

<br>

Both servers bind loopback by default.

```bash
EXPOSE=1 pnpm start:bg
# client started on http://192.168.99.101:5173 (also 127.0.0.1)

EXPOSE=1 pnpm dev          # same, foreground
```

`EXPOSE=1` binds `0.0.0.0`, opts Vite out of the Host-header check it uses to resist DNS rebinding,
and sets `APP_ORIGIN` to this host's address — without that last one, verification links point at
`localhost` and are useless on the device that has to tap them.

Set `ALLOWED_HOSTS` to a comma-separated list to keep Vite's host check meaningful, and `WEB_PORT` /
`PORT` to move the ports.

> [!WARNING]
> **This is a development server.** The session cookie isn't `secure`, `SESSION_SECRET` falls back to
> a known default, and the seeded accounts have a password published in this file. Fine on a private
> network you control; not fine on an untrusted one. Public internet means a reverse proxy with TLS
> and a real secret — not this port.

</details>

## Where things live

```
apps/server        Fastify API — routes/ stay thin, services/ hold the logic,
                   events/ is the SSE hub, jobs/ is the scheduler tick
apps/web           React 19 + Vite client
packages/shared    Zod schemas — the single definition of every API shape
```

`packages/shared` is the **only** place an API shape is defined. The server validates requests *and*
responses against those schemas; the client imports the inferred types. If the two ever disagree
about a field, the schema is right.

> [!IMPORTANT]
> **[`CLAUDE.md`](CLAUDE.md) is the reference** — architecture, data model, the full HTTP surface, and
> the invariants that are load-bearing. Most of them exist because the previous implementation broke
> them. Read it before changing anything non-obvious.

## Deployment

`Dockerfile` builds a single image: build the client, install production deps, run one Fastify process
serving both, with `data/` and `uploads/` as volumes.

**The image has never been built** — it was authored as a reviewable artifact, not part of the dev
loop, so treat its versions and paths as unverified. The *serving* half is verified natively;
`CLAUDE.md` has the recipe, and the reason `pnpm dev` can tell you nothing about it.

---

<div align="center">
<sub><a href="LICENSE">MIT</a> · This branch is the TypeScript rewrite; the Django implementation it replaces lives on <code>main</code>.</sub>
</div>
