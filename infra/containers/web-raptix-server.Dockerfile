# New-stack API image (W16 cutover): Fastify server + its own Prisma client.
# The build context NEVER references clients/web — the legacy Next UI is not a
# runtime upstream of this image (guide §14.3).
FROM node:22-slim AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY apps/shared/streaming/package.json apps/shared/streaming/
COPY apps/shared/web-contracts/package.json apps/shared/web-contracts/
COPY apps/web/server/package.json apps/web/server/
RUN npm ci --no-audit --no-fund --workspace=@raptix/streaming --workspace=@raptix/web-contracts --workspace=@raptix/web-raptix-server

COPY apps/shared ./apps/shared
COPY apps/web/server ./apps/web/server
RUN npm run build --workspace=@raptix/streaming \
 && npm run build --workspace=@raptix/web-contracts \
 && cd apps/web/server && npx prisma generate && npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# npm nests version-conflicting deps at the nearest workspace boundary: the
# server's ajv@8 lives under apps/web/node_modules while the hoisted
# root copy is ajv@6 (other tooling). Without this copy the runtime resolves
# the wrong ajv and ESM named exports break.
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/shared/streaming/package.json apps/shared/streaming/package.json
COPY --from=build /app/apps/shared/streaming/dist apps/shared/streaming/dist
COPY --from=build /app/apps/shared/web-contracts/package.json apps/shared/web-contracts/package.json
COPY --from=build /app/apps/shared/web-contracts/dist apps/shared/web-contracts/dist
COPY --from=build /app/apps/web/server/dist apps/web/server/dist
COPY --from=build /app/apps/web/server/prisma apps/web/server/prisma
# Prisma 7 CLI config: `migrate deploy` reads the datasource URL from here.
COPY --from=build /app/apps/web/server/prisma.config.ts apps/web/server/prisma.config.ts

WORKDIR /app/apps/web/server
ARG VERSION=0.0.0
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
EXPOSE 8081
# The new server owns its migrations (guide §13.4): deploy them at boot before
# serving. Migrations run against the dedicated new-stack database only.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
