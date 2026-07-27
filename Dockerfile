# Task Tracker — single-image deployment.
#
# Build the client, install production dependencies, run one Fastify process that
# serves both the API and the built client. `data/` is a volume.
#
# NOTE: this file is written but never built or run during development. It is a
# reviewable build artifact, not part of the dev loop.
# Treat every version and path here as unverified until someone actually builds it.

# Node 22 LTS to match `engines` in package.json. Debian slim rather than Alpine
# because better-sqlite3 compiles against glibc, and musl means either a second
# toolchain story or a subtly different binary.
ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# better-sqlite3 has no prebuilt binary for every platform, so the toolchain has
# to exist at install time. It stays in this stage and never reaches the runtime
# image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

# Manifests first, so a source-only change doesn't invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# -------------------------------------------------------------------- build web
FROM deps AS build-web
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# Type errors should fail the image, not ship to production.
RUN pnpm --filter @task-tracker/web exec tsc --noEmit \
  && pnpm --filter @task-tracker/web build

# ----------------------------------------------------------------- build server
FROM deps AS build-server
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server

# Prisma 7 has no query engine binary — it compiles queries and talks through the
# better-sqlite3 driver adapter — so `generate` only emits TypeScript. Nothing is
# downloaded here, which is what keeps this build hermetic.
RUN pnpm --filter @task-tracker/server exec prisma generate \
  && pnpm --filter @task-tracker/server exec tsc --noEmit

# Drop dev dependencies now that typechecking and generation are done.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts=false

# ------------------------------------------------------------------------ runtime
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_URL=file:data/app.db \
    UPLOAD_DIR=uploads

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable pnpm

# The server is run through tsx rather than emitted to JavaScript. `packages/shared`
# is consumed as TypeScript source so that it has exactly one definition of every
# API shape; compiling the server separately would mean either a second build of
# shared or an emitted import that cannot resolve at runtime. tsx is esbuild, so
# this is a transpile-on-load, not a type check — the type check already happened
# in build-server and failed the build if it was wrong.
COPY --from=build-server /app/node_modules node_modules
COPY --from=build-server /app/packages/shared packages/shared
COPY --from=build-server /app/apps/server apps/server
COPY --from=build-server /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build-server /app/tsconfig.base.json ./

# The client, served by Fastify at / with an SPA fallback.
COPY --from=build-web /app/apps/web/dist apps/web/dist

# `node` (uid 1000) ships with the base image. Running as root would also make
# the mounted data/ volume root-owned on the host.
RUN mkdir -p data uploads && chown -R node:node /app
USER node

# SQLite lives here, and so do uploaded avatars. Without a volume, every deploy
# loses the household.
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3001

# Fails the container on a wedged event loop, which a plain port check would miss.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run on start rather than in the image: the database is a mounted
# volume, so it does not exist at build time. `migrate deploy` only applies
# committed migrations and never generates or resets, which is what makes it safe
# to run unattended on every boot.
CMD ["sh", "-c", "pnpm --filter @task-tracker/server exec prisma migrate deploy && exec pnpm --filter @task-tracker/server start"]
