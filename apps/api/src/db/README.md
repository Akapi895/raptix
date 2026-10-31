Prisma client + schema for business records that have no Raptix runtime
equivalent (auth/session, RBAC, roles — see `apps/ui-app/src/features/rbac/`,
`roles/`). Not yet populated; the retired `apps/web/server/src/db/client.ts`
and its Prisma schema are a reference, recoverable from git history prior to
the ADR-0106 deletion commit, but the schema itself must be redesigned around
`apps/ui-app`'s contract, not copied as-is.
