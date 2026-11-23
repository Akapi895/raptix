import type { AssetStore } from "../db/asset-store.js";
import type { KgHost, KnowledgeGraph } from "../adapters/knowledge-graph/client.js";

type KgService = KgHost["services"][number];

const SOURCE = "neo4j-kg";
const HOSTNAME = /^[a-z0-9*](?:[a-z0-9*-]*[a-z0-9])?(?:\.[a-z0-9*](?:[a-z0-9*-]*[a-z0-9])?)*$/i;

/**
 * Bridges Raptix's real recon output (the Neo4j AKG's Host/Service nodes,
 * tagged with the project's engagement name) into the Asset table the
 * Asset Library page already reads for real -- see assets.routes.ts.
 * Reuses the existing /api/assets/import path (AssetStore.importUpsert),
 * which dedups per (projectId, host): one row per discovered host, not
 * per host:port, matching how a second FOFA-style import for the same
 * host already behaves (last sync wins on the aggregate fields).
 */
/** Syncs queue per project. The assets page sends several list requests at once, and each one runs this sync;
 *  unqueued, two syncs both find no row for a new host and each create one, leaving duplicate rows forever. */
const pendingSyncs = new Map<string, Promise<void>>();

export function syncAssetsFromKnowledgeGraph(
  kg: KnowledgeGraph,
  assetStore: AssetStore,
  projectId: string,
  engagement: string,
): Promise<void> {
  const run = (pendingSyncs.get(projectId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => syncOnce(kg, assetStore, projectId, engagement));
  pendingSyncs.set(projectId, run);
  return run;
}

async function syncOnce(kg: KnowledgeGraph, assetStore: AssetStore, projectId: string, engagement: string): Promise<void> {
  const nodes = await kg.hostsForEngagement(engagement).catch(() => []);
  if (nodes.length === 0) return;
  // The KG keeps one Host node per (address, name) pair, so one IP can appear several times. Fold them
  // into one row per address: every recorded name, and every observed service.
  const byAddress = new Map<string, { host: string; ip: string; names: string[]; services: KgService[] }>();
  for (const node of nodes) {
    const entry = byAddress.get(node.host) ?? { host: node.host, ip: node.ip, names: [], services: [] };
    // Some KG labels carry free text ("tk.cet.vnu.edu.vn DNS note"); only a hostname is a usable name.
    const name = node.hostname ?? "";
    if (HOSTNAME.test(name) && name !== node.ip && !entry.names.includes(name)) entry.names.push(name);
    for (const service of node.services) {
      if (!entry.services.some((known) => known.port === service.port && known.protocol === service.protocol)) entry.services.push(service);
    }
    byAddress.set(node.host, entry);
  }
  const items = [...byAddress.values()].map((entry) => {
    // Every Service node the KG returns was observed. Its `status` is an HTTP code or unset,
    // never "open", so filtering on it dropped every service and left Service blank.
    const services = [...entry.services].sort((a, b) => a.port - b.port);
    const primary = services[0];
    const summary = services.map((service) => `${service.protocol || "tcp"}/${service.port} ${service.service}${service.banner ? ` (${service.banner})` : ""}`).join("; ");
    return {
      projectId,
      host: entry.host,
      ip: entry.ip,
      // Recorded names, comma-separated (the matcher splits on commas): they let domain findings match this row.
      domain: entry.names.join(", "),
      port: primary?.port ?? 0,
      protocol: primary ? primary.protocol || "tcp" : "",
      title: services.map((service) => service.service).filter(Boolean).join(", "),
      server: summary,
      status: "active",
      source: SOURCE,
      sourceQuery: engagement,
    };
  });
  await assetStore.importUpsert(items);
}
