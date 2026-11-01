import type { AssetStore } from "../db/asset-store.js";
import type { KnowledgeGraph } from "../adapters/knowledge-graph/client.js";

const SOURCE = "neo4j-kg";

/**
 * Bridges Raptix's real recon output (the Neo4j AKG's Host/Service nodes,
 * tagged with the project's engagement name) into the Asset table the
 * Asset Library page already reads for real -- see assets.routes.ts.
 * Reuses the existing /api/assets/import path (AssetStore.importUpsert),
 * which dedups per (projectId, host): one row per discovered host, not
 * per host:port, matching how a second FOFA-style import for the same
 * host already behaves (last sync wins on the aggregate fields).
 */
export async function syncAssetsFromKnowledgeGraph(
  kg: KnowledgeGraph,
  assetStore: AssetStore,
  projectId: string,
  engagement: string,
): Promise<void> {
  const hosts = await kg.hostsForEngagement(engagement).catch(() => []);
  if (hosts.length === 0) return;
  const items = hosts.map((host) => {
    const open = host.services.filter((service) => service.status === "open").sort((a, b) => a.port - b.port);
    const primary = open[0];
    const summary = open.map((service) => `${service.protocol || "tcp"}/${service.port} ${service.service}${service.banner ? ` (${service.banner})` : ""}`).join("; ");
    return {
      projectId,
      host: host.host,
      ip: host.ip,
      port: primary?.port ?? 0,
      protocol: primary?.protocol ?? "",
      title: open.map((service) => service.service).filter(Boolean).join(", "),
      server: summary,
      status: "active",
      source: SOURCE,
      sourceQuery: engagement,
    };
  });
  await assetStore.importUpsert(items);
}
