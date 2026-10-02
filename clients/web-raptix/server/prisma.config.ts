import { defineConfig } from 'prisma/config';

// Prisma 7 CLI config for the new migration owner (clients/web-raptix/server).
// Only the migration/introspection commands need `datasource.url`; generate is
// intentionally runnable without DATABASE_URL, so the datasource block is only
// added when the variable is actually present in the environment.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(process.env.DATABASE_URL
    ? { datasource: { url: process.env.DATABASE_URL } }
    : {}),
});
