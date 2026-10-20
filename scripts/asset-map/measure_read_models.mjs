/**
 * Latency of the asset-map read models on a live engagement (plan phase 8).
 *
 * Runs inside the web API container against the deployed build, so the database and the graph are
 * the ones the product uses. The script is piped in because the API image does not carry the repo:
 *
 *   docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml  *     exec -T web-raptix-api node --input-type=module - <ownerUserId> <engagementId> [iterations]  *     < scripts/asset-map/measure_read_models.mjs
 *
 * <ownerUserId> is Engagement.userId of the engagement. The script reconciles the catalog once, then
 * times each read after a warm-up and prints p50, p95 and max in milliseconds plus response bytes.
 */
import { createDbClient, disconnectDb } from '/app/apps/web/server/dist/db/client.js'
import { GraphService } from '/app/apps/web/server/dist/services/graph-service.js'
import { AssetMapService } from '/app/apps/web/server/dist/services/asset-map-service.js'

const [owner, engagementId, rawIterations] = process.argv.slice(2)
if (!owner || !engagementId) {
  console.error('usage: measure_read_models.mjs <ownerUserId> <engagementId> [iterations]')
  process.exit(2)
}
const iterations = Number(rawIterations ?? 20)
const db = createDbClient({ connectionString: process.env.DATABASE_URL })
const graph = { httpUri: process.env.NEO4J_HTTP_URI, user: process.env.NEO4J_USER, password: process.env.NEO4J_PASSWORD }
const maps = new AssetMapService(db, graph)
const report = {}

const measure = async (label, run) => {
  await run()
  const times = []
  let bytes = 0
  let last
  for (let i = 0; i < iterations; i++) {
    const started = performance.now()
    last = await run()
    times.push(performance.now() - started)
    if (i === 0) bytes = Buffer.byteLength(JSON.stringify(last), 'utf8')
  }
  times.sort((a, b) => a - b)
  const at = share => Math.round(times[Math.min(times.length - 1, Math.floor(share * times.length))])
  report[label] = { p50: at(0.5), p95: at(0.95), max: Math.round(times[times.length - 1]), iterations, bytes }
  return last
}

try {
  report.reconcile = await new GraphService(db, graph).reconcileCatalog(owner, engagementId)
  await measure('overview', () => maps.overview(owner, engagementId))
  await measure('members hosts page50', () => maps.members(owner, engagementId, 'host', null, 50))
  const hostPage = await maps.members(owner, engagementId, 'host', null, 1)
  const host = hostPage.items[0]
  const origins = await maps.members(owner, engagementId, 'web_origin', null, 1)
  const origin = origins.items[0]
  await measure('search 10.', () => maps.search(owner, engagementId, '10.', 25))
  if (host) {
    await measure('neighborhood host', () => maps.neighborhood(owner, engagementId, host.assetId))
    await measure('detail host services', () => maps.detail(owner, engagementId, host.assetId, null, 50))
  }
  if (origin) await measure('detail origin endpoints page100', () => maps.detail(owner, engagementId, origin.assetId, null, 100))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await disconnectDb(db)
}
