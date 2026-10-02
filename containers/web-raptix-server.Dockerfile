# New-stack API image (W16 cutover): Fastify server + its own Prisma client.
# The build context NEVER references clients/web — the legacy Next UI is not a
# runtime upstream of this image (guide §14.3).
FROM node:22-slim AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY clients/shared/streaming/package.json clients/shared/streaming/
COPY clients/shared/web-contracts/package.json clients/shared/web-contracts/
COPY clients/web-raptix/server/package.json clients/web-raptix/server/
RUN npm ci --no-audit --no-fund --workspace=@raptix/streaming --workspace=@raptix/web-contracts --workspace=@raptix/web-raptix-server

COPY clients/shared ./clients/shared
COPY clients/web-raptix/server ./clients/web-raptix/server
RUN npm run build --workspace=@raptix/streaming \
 && npm run build --workspace=@raptix/web-contracts \
 && cd clients/web-raptix/server && npx prisma generate && npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# npm nests version-conflicting deps at the nearest workspace boundary: the
# server's ajv@8 lives under clients/web-raptix/node_modules while the hoisted
# root copy is ajv@6 (other tooling). Without this copy the runtime resolves
# the wrong ajv and ESM named exports break.
COPY --from=build /app/clients/web-raptix/node_modules ./clients/web-raptix/node_modules
COPY --from=build /app/clients/shared/streaming/package.json clients/shared/streaming/package.json
COPY --from=build /app/clients/shared/streaming/dist clients/shared/streaming/dist
COPY --from=build /app/clients/shared/web-contracts/package.json clients/shared/web-contracts/package.json
COPY --from=build /app/clients/shared/web-contracts/dist clients/shared/web-contracts/dist
COPY --from=build /app/clients/web-raptix/server/dist clients/web-raptix/server/dist
COPY --from=build /app/clients/web-raptix/server/prisma clients/web-raptix/server/prisma
# Prisma 7 CLI config: `migrate deploy` reads the datasource URL from here.
COPY --from=build /app/clients/web-raptix/server/prisma.config.ts clients/web-raptix/server/prisma.config.ts

WORKDIR /app/clients/web-raptix/server
EXPOSE 8081
# The new server owns its migrations (guide §13.4): deploy them at boot before
# serving. Migrations run against the dedicated new-stack database only.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
