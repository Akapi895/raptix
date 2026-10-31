# apps/api -- the ui-app BFF (ADR-0106). Multi-stage build mirroring
# cli.Dockerfile's shape: build with full devDependencies (Prisma CLI,
# TypeScript), ship only the compiled output + production node_modules.

# ── Stage 1: Build ────────────────────────────────────────────────
FROM node:24-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/

ARG VERSION=0.0.0
RUN sed -i 's/"version": "[^"]*"/"version": "'"$VERSION"'"/' apps/api/package.json

RUN npm ci --workspace=@raptix/api

COPY apps/api/ apps/api/

# The Prisma client (src/generated/prisma) is generated TypeScript, not
# checked in (gitignored) -- it has to exist before tsc runs, and tsc's
# own `include` picks it up alongside the rest of src/**/*.ts.
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=@raptix/api

# ── Stage 2: Runtime ──────────────────────────────────────────────
FROM node:24-slim
WORKDIR /app

# node:24-slim ships no libssl at all, so Prisma's query engine can't
# detect an OpenSSL version and silently guesses one -- install it for
# real instead of running production on that guess.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# `prisma` (the CLI, not just @prisma/client) is a production dependency
# of apps/api specifically so `prisma migrate deploy` is available here --
# see apps/api/package.json's own comment on that dependency.
#
# npm workspaces hoist shared deps to the *root* node_modules, not
# apps/api/node_modules (which holds only what couldn't be hoisted) --
# copy the root one, the same as cli.Dockerfile does for apps/cli.
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/apps/api/prisma.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma

ENV NODE_ENV=production

HEALTHCHECK --interval=5s --timeout=5s --retries=12 --start-period=30s \
  CMD node -e "require('http').get('http://localhost:' + (process.env.API_PORT || 8080) + '/api/health', r => { r.resume(); process.exit(r.statusCode < 500 ? 0 : 1); }).on('error', () => process.exit(1))"

# Migrations apply once at container start, before the server binds its
# port -- deploy-time, not request-time, so a bad migration fails the
# container (and its healthcheck) instead of surfacing as a 500 on the
# first real request.
ENTRYPOINT ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
