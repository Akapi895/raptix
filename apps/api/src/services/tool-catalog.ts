import type { RuntimeTransport } from "../adapters/runtime/client.js";
import { RuntimeUnavailableError } from "../adapters/runtime/errors.js";

/** Read-only catalog availability, not a mutable global tool switch. */
export interface WireTool {
  name: string;
  description: string;
  enabled: boolean;
  is_external: boolean;
  external_mcp: string;
}

export interface WireToolPage {
  tools: WireTool[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  total_enabled: number;
}

interface CatalogCapability {
  name?: unknown;
  description?: unknown;
  available?: boolean;
}

interface CatalogShape {
  tools?: CatalogCapability[];
  servers?: { name?: unknown; tools?: CatalogCapability[] }[];
}

/**
 * The role editor's tool picker needs the runtime's real tool inventory.
 * The runtime exposes it per specialist (`/_raptix/specialists/catalog`),
 * so the union across the registered graphs IS the inventory -- assembled
 * here, searched and paginated server-side. Never hardcoded: a copy here
 * would drift from the real catalog silently (the reason GET
 * /api/config/tools used to be a 501 before the runtime catalog existed).
 */
const ORCHESTRATOR_GRAPH_IDS = new Set(["raptix", "raptix-delta", "decepticon"]);
/** Cold builds cost the runtime ~8s+ of catalog work; a few minutes of staleness is fine for a picker. */
const CACHE_TTL_MS = 300_000;

export class ToolCatalogService {
  private cache: { at: number; tools: WireTool[] } | null = null;
  private inFlight: Promise<WireTool[]> | null = null;

  constructor(private readonly runtime: RuntimeTransport) {}

  async listTools(search: string, page: number, pageSize: number): Promise<WireToolPage> {
    const all = await this.union();
    const needle = search.trim().toLowerCase();
    const filtered = needle ? all.filter(tool => tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle)) : all;
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, page), totalPages);
    return {
      tools: filtered.slice((current - 1) * pageSize, current * pageSize),
      page: current,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      total_enabled: filtered.filter(tool => tool.enabled).length,
    };
  }

  /** Cached union; concurrent callers share one build, and a failure is never cached. */
  private async union(): Promise<WireTool[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.tools;
    if (!this.inFlight) this.inFlight = this.buildUnion().finally(() => { this.inFlight = null; });
    const tools = await this.inFlight;
    this.cache = { at: Date.now(), tools };
    return tools;
  }

  private async buildUnion(): Promise<WireTool[]> {
    const { graphIds } = await this.runtime.ping();
    const ids = graphIds.filter(id => !ORCHESTRATOR_GRAPH_IDS.has(id));
    // Each catalog assembles an agent and discovers MCP. Avoid flooding the
    // runtime with every specialist at once (which exhausts its HTTP timeout).
    const catalogs: PromiseSettledResult<unknown>[] = [];
    for (let offset = 0; offset < ids.length; offset += 3) {
      catalogs.push(...await Promise.allSettled(ids.slice(offset, offset + 3).map(id =>
        this.runtime.specialistRequest(`/_raptix/specialists/catalog?specialist_id=${encodeURIComponent(id)}`))));
    }
    const byName = new Map<string, WireTool>();
    let reachable = 0;
    for (const result of catalogs) {
      if (result.status === "rejected") continue;
      const catalog = result.value as CatalogShape;
      if (!Array.isArray(catalog.tools)) continue;
      reachable++;
      for (const tool of Array.isArray(catalog.tools) ? catalog.tools : []) mergeTool(byName, tool, false, "");
      for (const server of Array.isArray(catalog.servers) ? catalog.servers : []) {
        const serverName = typeof server.name === "string" ? server.name : "";
        for (const tool of Array.isArray(server.tools) ? server.tools : []) mergeTool(byName, tool, true, serverName);
      }
    }
    if (reachable === 0) throw new RuntimeUnavailableError("The runtime tool catalog is unavailable");
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

function mergeTool(byName: Map<string, WireTool>, raw: CatalogCapability, isExternal: boolean, server: string): void {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return;
  const description = typeof raw.description === "string" ? raw.description : "";
  const key = isExternal ? `${server}::${name}` : name;
  const existing = byName.get(key);
  if (!existing) {
    byName.set(key, { name, description, enabled: raw.available !== false, is_external: isExternal, external_mcp: server });
    return;
  }
  if (!existing.description && description) existing.description = description;
}
