Prisma client + schema for business records that have no Raptix runtime
equivalent. `client.ts` is a thin factory (PostgreSQL driver adapter, no env
reads); `auth-store.ts` is the `AuthStore` port (Tier 1: `Operator`/
`Session`) plus its Prisma implementation -- routes depend on the port, not
on Prisma directly, so they're testable without a database
(`tests/support/fake-auth-store.ts`). RBAC/roles proper (see
`apps/ui-app/src/features/rbac/`, `roles/`) is a Tier 6 design spike, not
this schema; don't extend `Operator`/`Session` to cover it without reading
that spike first. The retired `apps/web/server`'s Prisma schema is a loose
reference only (recoverable from git history prior to the ADR-0106 deletion
commit), not something to copy as-is.
