/**
 * Backfill rehearsal for the asset catalog (plan phase 8), run against the deployed API build:
 *
 *   docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml \
 *     exec -T web-raptix-api node --input-type=module - <ownerUserId> <engagementId> \
 *     < scripts/asset-map/backfill_rehearsal.mjs
 *
 * It proves three things on the live data, without touching the KG:
 *   1. the first reconcile catalogues every identity and rejects nothing;
 *   2. a second reconcile creates nothing (replay is a no-op);
 *   3. after the catalog rows are deleted (a rollback of the backfill), the next reconcile recreates
 *      exactly the same identifier set, so identities are deterministic and a rollback is safe.
 */
import { createHash } from 'node:crypto'
import { createDbClient, disconnectDb } from '/app/apps/web/server/dist/db/client.js'
import { GraphService } from '/app/apps/web/server/dist/services/graph-service.js'

const [owner, engagementId] = process.argv.slice(2)
if (!owner || !engagementId) {
  console.error('usage: backfill_rehearsal.mjs <ownerUserId> <engagementId>')
  process.exit(2)
}
const db = createDbClient({ connectionString: process.env.DATABASE_URL })
const graph = { httpUri: process.env.NEO4J_HTTP_URI, user: process.env.NEO4J_USER, password: process.env.NEO4J_PASSWORD }
const service = new GraphService(db, graph)
const fingerprint = async () => {
  const rows = await db.assetIdentity.findMany({ where: { engagementId }, select: { id: true }, orderBy: { id: 'asc' } })
  return { count: rows.length, sha256: createHash('sha256').update(rows.map(row => row.id).join('\n')).digest('hex') }
}
const started = performance.now()
try {
  const first = await service.reconcileCatalog(owner, engagementId)
  const afterFirst = await fingerprint()
  const replay = await service.reconcileCatalog(owner, engagementId)
  const afterReplay = await fingerprint()
  await db.assetIdentity.deleteMany({ where: { engagementId } })
  const rolledBack = await fingerprint()
  const restored = await service.reconcileCatalog(owner, engagementId)
  const afterRestore = await fingerprint()
  const checks = {
    firstCatalogues: first.created === afterFirst.count && first.rejected.length === 0,
    replayCreatesNothing: replay.created === 0 && afterReplay.sha256 === afterFirst.sha256,
    rollbackEmpties: rolledBack.count === 0,
    restoreIsDeterministic: afterRestore.sha256 === afterFirst.sha256 && restored.created === afterFirst.count,
  }
  console.log(JSON.stringify({ first, replay, restored, fingerprint: afterFirst, checks, ms: Math.round(performance.now() - started), ok: Object.values(checks).every(Boolean) }, null, 2))
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1
} finally {
  await disconnectDb(db)
}
