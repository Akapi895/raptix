import type { FastifyInstance } from "fastify";
import type { AssetFields, AssetRecord, AssetStore } from "../../db/asset-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface AssetRoutesOptions {
  authStore: AuthStore;
  assetStore: AssetStore;
}

interface ListQuery {
  page?: string;
  page_size?: string;
  project_id?: string;
  status?: string;
  protocol?: string;
  host?: string;
  ip?: string;
  domain?: string;
  port?: string;
  q?: string;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** apps/ui-app's Asset shape (src/api/types/asset.ts). vulnerability_count is always 0 -- see schema.prisma's comment. */
function toWire(asset: AssetRecord): Record<string, unknown> {
  return {
    id: asset.id,
    project_id: asset.projectId ?? "",
    host: asset.host,
    ip: asset.ip,
    port: asset.port,
    domain: asset.domain,
    protocol: asset.protocol,
    title: asset.title,
    server: asset.server,
    country: asset.country,
    province: asset.province,
    city: asset.city,
    responsible_person: asset.responsiblePerson,
    department: asset.department,
    business_system: asset.businessSystem,
    environment: asset.environment,
    criticality: asset.criticality,
    source: asset.source,
    source_query: asset.sourceQuery,
    status: asset.status,
    tags: asset.tags,
    first_seen_at: asset.firstSeenAt.toISOString(),
    last_seen_at: asset.lastSeenAt.toISOString(),
    created_at: asset.createdAt.toISOString(),
    updated_at: asset.updatedAt.toISOString(),
    vulnerability_count: 0,
    risk_level: asset.criticality || "unknown",
  };
}

function fieldsFromBody(body: Record<string, unknown> | undefined): AssetFields {
  if (!body) return {};
  return {
    ...(body.project_id !== undefined ? { projectId: asString(body.project_id) ?? null } : {}),
    ...(body.host !== undefined ? { host: asString(body.host) ?? "" } : {}),
    ...(body.ip !== undefined ? { ip: asString(body.ip) ?? "" } : {}),
    ...(body.port !== undefined ? { port: Number(body.port) || 0 } : {}),
    ...(body.domain !== undefined ? { domain: asString(body.domain) ?? "" } : {}),
    ...(body.protocol !== undefined ? { protocol: asString(body.protocol) ?? "" } : {}),
    ...(body.title !== undefined ? { title: asString(body.title) ?? "" } : {}),
    ...(body.server !== undefined ? { server: asString(body.server) ?? "" } : {}),
    ...(body.country !== undefined ? { country: asString(body.country) ?? "" } : {}),
    ...(body.province !== undefined ? { province: asString(body.province) ?? "" } : {}),
    ...(body.city !== undefined ? { city: asString(body.city) ?? "" } : {}),
    ...(body.responsible_person !== undefined ? { responsiblePerson: asString(body.responsible_person) ?? "" } : {}),
    ...(body.department !== undefined ? { department: asString(body.department) ?? "" } : {}),
    ...(body.business_system !== undefined ? { businessSystem: asString(body.business_system) ?? "" } : {}),
    ...(body.environment !== undefined ? { environment: asString(body.environment) ?? "" } : {}),
    ...(body.criticality !== undefined ? { criticality: asString(body.criticality) ?? "" } : {}),
    ...(body.source !== undefined ? { source: asString(body.source) ?? "" } : {}),
    ...(body.source_query !== undefined ? { sourceQuery: asString(body.source_query) ?? "" } : {}),
    ...(body.status !== undefined ? { status: asString(body.status) ?? "active" } : {}),
    ...(body.tags !== undefined ? { tags: asStringArray(body.tags) } : {}),
  };
}

export function registerAssetRoutes(app: FastifyInstance, options: AssetRoutesOptions): void {
  const { authStore, assetStore } = options;
  const requireSession = createRequireSession(authStore);

  app.get<{ Querystring: ListQuery }>("/api/assets", { preHandler: requireSession }, async (request, reply) => {
    const pageSize = Number(request.query.page_size ?? 20) || 20;
    const page = Number(request.query.page ?? 1) || 1;
    const { assets, total } = await assetStore.list({
      projectId: request.query.project_id,
      status: request.query.status,
      protocol: request.query.protocol,
      host: request.query.host,
      ip: request.query.ip,
      domain: request.query.domain,
      port: request.query.port !== undefined ? Number(request.query.port) : undefined,
      search: request.query.q,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    await reply.send({
      assets: assets.map(toWire),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  });

  app.get<{ Querystring: ListQuery }>(
    "/api/assets/selection",
    { preHandler: requireSession },
    async (request, reply) => {
      const { assets } = await assetStore.list({
        projectId: request.query.project_id,
        status: request.query.status,
        protocol: request.query.protocol,
        search: request.query.q,
        limit: 1000,
        offset: 0,
      });
      await reply.send({ assets: assets.map(toWire) });
    },
  );

  app.get("/api/assets/stats", { preHandler: requireSession }, async (_request, reply) => {
    await reply.send(await assetStore.stats());
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/assets/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const asset = await assetStore.replace(request.params.id, fieldsFromBody(request.body));
      if (!asset) {
        await reply.code(404).send({ error: "Asset not found" });
        return;
      }
      await reply.send(toWire(asset));
    },
  );

  app.delete<{ Params: { id: string } }>("/api/assets/:id", { preHandler: requireSession }, async (request, reply) => {
    const deleted = await assetStore.delete(request.params.id);
    if (!deleted) {
      await reply.code(404).send({ error: "Asset not found" });
      return;
    }
    await reply.send({ success: true });
  });

  app.post<{ Body: { asset_ids?: unknown } }>(
    "/api/assets/batch-delete",
    { preHandler: requireSession },
    async (request, reply) => {
      const ids = asStringArray(request.body?.asset_ids);
      const count = await assetStore.batchDelete(ids);
      await reply.send({ success: true, deleted: count });
    },
  );

  app.put<{ Body: Record<string, unknown> }>("/api/assets/bulk", { preHandler: requireSession }, async (request, reply) => {
    const ids = asStringArray(request.body?.asset_ids);
    const rest = { ...(request.body ?? {}) };
    delete rest.asset_ids;
    const count = await assetStore.bulkPatch(ids, fieldsFromBody(rest));
    await reply.send({ success: true, updated: count });
  });

  app.post<{ Body: { assets?: unknown; source?: unknown; source_query?: unknown } }>(
    "/api/assets/import",
    { preHandler: requireSession },
    async (request, reply) => {
      const items = Array.isArray(request.body?.assets) ? request.body.assets : [];
      const source = asString(request.body?.source);
      const sourceQuery = asString(request.body?.source_query);
      const fields = items
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({ ...fieldsFromBody(item), ...(source ? { source } : {}), ...(sourceQuery ? { sourceQuery } : {}) }));
      await reply.send(await assetStore.importUpsert(fields));
    },
  );

  app.post<{ Body: { asset_ids?: unknown; primary_id?: unknown } }>(
    "/api/assets/merge",
    { preHandler: requireSession },
    async (request, reply) => {
      const ids = asStringArray(request.body?.asset_ids);
      const primaryId = asString(request.body?.primary_id) ?? ids[0];
      if (!primaryId) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const merged = await assetStore.merge(primaryId, ids);
      if (!merged) {
        await reply.code(404).send({ error: "Asset not found" });
        return;
      }
      await reply.send(toWire(merged));
    },
  );

  app.put<{ Body: { asset_ids?: unknown; project_id?: unknown } }>(
    "/api/assets/project-binding",
    { preHandler: requireSession },
    async (request, reply) => {
      const ids = asStringArray(request.body?.asset_ids);
      const projectId = asString(request.body?.project_id) ?? null;
      const count = await assetStore.setProjectBinding(ids, projectId);
      await reply.send({ success: true, updated: count });
    },
  );

  // Scan links: the assets feature POSTs these when the operator launches a
  // scan (asset_id + conversation_id, or asset_id + queue_id + task_id) and
  // ignores the response. Unknown asset ids are a 400 -- never a silent row
  // pointing at nothing. Stored relationally; not the Neo4j AKG (the plan's
  // Tier 3 "observed scan relationships" guess was wrong -- see
  // schema.prisma's ScanLink comment).
  app.post<{ Body: { scans?: unknown } }>(
    "/api/assets/scan-links",
    { preHandler: requireSession },
    async (request, reply) => {
      const scans = Array.isArray(request.body?.scans) ? request.body.scans : [];
      const parsed = scans.map((scan) => {
        const body = (scan ?? {}) as Record<string, unknown>;
        return {
          assetId: asString(body.asset_id) ?? "",
          conversationId: asString(body.conversation_id) ?? "",
          queueId: asString(body.queue_id) ?? "",
          taskId: asString(body.task_id) ?? "",
        };
      });
      if (parsed.length === 0 || parsed.some((scan) => scan.assetId === "")) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      const assetIds = [...new Set(parsed.map((scan) => scan.assetId))];
      const known = await assetStore.findByIds(assetIds);
      if (known.length !== assetIds.length) {
        const knownIds = new Set(known.map((asset) => asset.id));
        const missing = assetIds.find((id) => !knownIds.has(id)) ?? "";
        await reply.code(400).send({ error: `Asset not found: ${missing}` });
        return;
      }
      await assetStore.createScanLinks(parsed);
      await reply.send({ success: true });
    },
  );
}
