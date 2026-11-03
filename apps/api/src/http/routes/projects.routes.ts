import type { FastifyInstance, FastifyReply } from "fastify";
import { SandboxProvisionError, type SandboxProvisioner } from "../../adapters/sandbox/controller.js";
import type { AttackChainService } from "../../services/attack-chain.js";
import { FactNotFoundError, type FactEdgeRecord, type FactRecord, type FactStore, type UpdateFactInput } from "../../db/fact-store.js";
import { newWorkspaceSlug } from "../../db/project-store.js";
import type { AssetStore } from "../../db/asset-store.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ConversationStore } from "../../db/conversation-store.js";
import type { ProjectRecord, ProjectStore } from "../../db/project-store.js";
import type { VulnerabilityStore } from "../../db/vulnerability-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ProjectRoutesOptions {
  authStore: AuthStore;
  projectStore: ProjectStore;
  conversationStore: ConversationStore;
  factStore: FactStore;
  assetStore: AssetStore;
  vulnerabilityStore: VulnerabilityStore;
  attackChainService: AttackChainService;
  /** ADR-0086 A: every project gets its own sandbox container at creation, before the row is persisted. */
  sandboxProvisioner: SandboxProvisioner;
}

interface ListQuery {
  status?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

interface CreateBody {
  name?: unknown;
  description?: unknown;
  scope_json?: unknown;
  status?: unknown;
}

interface UpdateBody {
  name?: unknown;
  description?: unknown;
  scope_json?: unknown;
  status?: unknown;
  pinned?: unknown;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const asNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined;

/** apps/ui-app's Project shape (src/api/types/project.ts): snake_case, unlike Conversation's camelCase. */
function toWire(project: ProjectRecord): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? "",
    scope_json: project.scopeJson ?? "",
    status: project.status,
    pinned: project.pinned,
    created_at: project.createdAt.toISOString(),
    updated_at: project.updatedAt.toISOString(),
    conversation_count: project.conversationCount,
    vulnerability_count: project.vulnerabilityCount,
    asset_count: project.assetCount,
  };
}

/** Prisma unique-violation (P2002): a duplicate fact_key within one project. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** apps/ui-app's FactResponse (T519): list mode carries incoming_links as a count. */
function factToWire(fact: FactRecord, incomingLinks: number): Record<string, unknown> {
  return {
    id: fact.id,
    project_id: fact.projectId,
    fact_key: fact.factKey,
    category: fact.category,
    summary: fact.summary,
    body: fact.body,
    confidence: fact.confidence,
    pinned: fact.pinned,
    deprecated: fact.deprecated,
    incoming_links: incomingLinks,
    related_vulnerability_id: fact.relatedVulnerabilityId,
    source_conversation_id: fact.sourceConversationId,
    source_message_id: fact.sourceMessageId,
    verification_state: fact.verificationState,
    verification_source: fact.verificationSource,
    verified_at: fact.verifiedAt?.toISOString() ?? null,
    verified_by: fact.verifiedBy,
    revision: fact.revision,
    created_at: fact.createdAt.toISOString(),
    updated_at: fact.updatedAt.toISOString(),
  };
}

/** apps/ui-app's ProjectFactEdge (T76): both the Go field pair (source/target/type) and its aliases. */
function edgeToWire(edge: FactEdgeRecord): Record<string, unknown> {
  return {
    id: edge.id,
    project_id: edge.projectId,
    source: edge.sourceFactKey,
    target: edge.targetFactKey,
    source_fact_key: edge.sourceFactKey,
    target_fact_key: edge.targetFactKey,
    type: edge.edgeType,
    edge_type: edge.edgeType,
    confidence: edge.confidence,
  };
}

/** Collects the fact_keys/ids the deprecate/restore endpoints accept (the mock matches either). */
function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

interface FactsQuery {
  fact_key?: string;
  q?: string;
  search?: string;
  category?: string;
  confidence?: string;
  hide_deprecated?: string;
  exclude_deprecated?: string;
  related_vulnerability_id?: string;
  limit?: string;
  offset?: string;
}

export function registerProjectRoutes(app: FastifyInstance, options: ProjectRoutesOptions): void {
  const { authStore, projectStore, conversationStore, factStore, assetStore, vulnerabilityStore, attackChainService } = options;
  const requireSession = createRequireSession(authStore);

  // The dashboard's totals strip (T463_ProjectSummary): real aggregates over
  // every store, with the latest facts on top. Registered before the /:id
  // routes for readability (find-my-way prefers the static segment anyway).
  app.get<{ Querystring: { fact_limit?: string } }>(
    "/api/projects/dashboard-summary",
    { preHandler: requireSession },
    async (request, reply) => {
      const factLimit = Number(request.query.fact_limit ?? 5) || 5;
      const [active, all, recent, conversations, vulnerabilities, openVulnerabilities, assets] = await Promise.all([
        projectStore.list({ status: "active", limit: 0, offset: 0 }),
        projectStore.list({ limit: 0, offset: 0 }),
        factStore.listRecent(factLimit),
        conversationStore.list({ limit: 0, offset: 0 }),
        vulnerabilityStore.list({ limit: 0, offset: 0 }),
        vulnerabilityStore.list({ status: "open", limit: 0, offset: 0 }),
        assetStore.list({ limit: 0, offset: 0 }),
      ]);
      // Recent facts can span projects; incoming-link counts are per-project
      // because fact keys are only unique within one.
      const keysByProject = new Map<string, string[]>();
      for (const fact of recent) {
        const keys = keysByProject.get(fact.projectId) ?? [];
        keys.push(fact.factKey);
        keysByProject.set(fact.projectId, keys);
      }
      const linkCounts = new Map<string, number>();
      await Promise.all(
        [...keysByProject].map(async ([projectId, keys]) => {
          for (const [key, count] of await factStore.incomingCounts(projectId, keys)) {
            linkCounts.set(`${projectId}|${key}`, count);
          }
        }),
      );
      await reply.send({
        active_projects: active.total,
        total_facts: await factStore.countAll(),
        recent_facts: recent.map((fact) => factToWire(fact, linkCounts.get(`${fact.projectId}|${fact.factKey}`) ?? 0)),
        totals: {
          projects: all.total,
          conversations: conversations.total,
          vulnerabilities: vulnerabilities.total,
          assets: assets.total,
          open_vulnerabilities: openVulnerabilities.total,
        },
      });
    },
  );

  /** 404s when the path project does not exist; returns the project otherwise. */
  async function findProjectOr404(reply: FastifyReply, id: string) {
    const project = await projectStore.findById(id);
    if (!project) {
      await reply.code(404).send({ error: "Project not found" });
      return null;
    }
    return project;
  }

  app.get<{ Querystring: ListQuery }>("/api/projects", { preHandler: requireSession }, async (request, reply) => {
    const limit = Number(request.query.limit ?? 20) || 20;
    const offset = Number(request.query.offset ?? 0) || 0;
    const { projects, total } = await projectStore.list({
      status: request.query.status,
      search: request.query.search,
      limit,
      offset,
    });
    await reply.send({ projects: projects.map(toWire), total, limit, offset });
  });

  app.post<{ Body: CreateBody }>("/api/projects", { preHandler: requireSession }, async (request, reply) => {
    const name = asString(request.body?.name);
    if (!name) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    // Create order matters (ADR-0086 A): issue the slug, start the project's
    // own sandbox container, then persist. A failed start returns 503 and
    // leaves no row, so a project never exists without its sandbox. Residue
    // from a persist failure is accepted; an operator removes it with
    // `docker rm -f sbx-<slug>`.
    const workspaceSlug = newWorkspaceSlug();
    try {
      await options.sandboxProvisioner.ensure(workspaceSlug);
    } catch (error) {
      if (error instanceof SandboxProvisionError) {
        await reply.code(503).send({ error: error.message });
        return;
      }
      throw error;
    }
    const project = await projectStore.create({
      name,
      description: asString(request.body?.description),
      scopeJson: asString(request.body?.scope_json),
      status: asString(request.body?.status),
      workspaceSlug,
    });
    await reply.send(toWire(project));
  });

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.id);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send(toWire(project));
    },
  );

  app.put<{ Params: { id: string }; Body: UpdateBody }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.update(request.params.id, {
        name: asNullableString(request.body?.name),
        description: asNullableString(request.body?.description),
        scopeJson: asNullableString(request.body?.scope_json),
        status: asNullableString(request.body?.status),
        pinned: typeof request.body?.pinned === "boolean" ? request.body.pinned : undefined,
      });
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send(toWire(project));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const deleted = await projectStore.delete(request.params.id);
      if (!deleted) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/stats",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      // apps/ui-app's Stats (T518) + the mock's vulnerability_stats: counts
      // over this project's facts (non-deprecated), conversations, assets and
      // vulnerabilities with their severity/status breakdown.
      const [factCount, vulnStats, counts] = await Promise.all([
        factStore.count(project.id, true),
        vulnerabilityStore.projectStats(project.id),
        projectStore.stats(project.id),
      ]);
      if (!counts) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      await reply.send({
        fact_count: factCount,
        vuln_count: vulnStats.total,
        conversation_count: counts.conversations,
        asset_count: counts.assets,
        vulnerability_stats: {
          total: vulnStats.total,
          by_severity: vulnStats.bySeverity,
          by_status: vulnStats.byStatus,
        },
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    "/api/projects/:id/conversations",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await projectStore.findById(request.params.id);
      if (!project) {
        await reply.code(404).send({ error: "Project not found" });
        return;
      }
      const limit = Number(request.query.limit ?? 50) || 50;
      const offset = Number(request.query.offset ?? 0) || 0;
      const { conversations, total } = await conversationStore.list({ projectId: project.id, limit, offset });
      await reply.send({
        conversations: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          projectId: c.projectId ?? "",
          roleName: c.roleName ?? "",
          agentMode: c.agentMode,
          pinned: c.pinned,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        limit,
        offset,
      });
    },
  );

  // Project facts + fact edges (apps/ui-app's facts tab / fact-graph): the
  // contract is relational CRUD -- fact_key/category/summary/confidence
  // records the original Go backend kept in Postgres, and the mock derives
  // the graph view from the same two tables. The runtime's Neo4j AKG is a
  // scanner-observation graph with a different node model; it is not the
  // backend for these endpoints (the plan's first draft said otherwise -- see
  // schema.prisma's correction note). promote-attack-chain stays a 501: it
  // derives facts from a conversation transcript via an LLM call, which no
  // LLM client in apps/api can make yet.
  app.get<{ Params: { id: string }; Querystring: FactsQuery }>(
    "/api/projects/:id/facts",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      const factKey = request.query.fact_key;
      if (factKey) {
        const fact = await factStore.findByKey(project.id, factKey);
        if (!fact) {
          await reply.code(404).send({ error: "Fact not found" });
          return;
        }
        // Single-fact read (factWithLinksResponse): incoming links as edge
        // details plus link counts in both directions.
        const [links, counts] = await Promise.all([
          factStore.incomingLinks(project.id, fact.factKey),
          factStore.linkCounts(project.id, fact.factKey),
        ]);
        await reply.send({
          ...factToWire(fact, links.length),
          incoming_links: links.map((link) => ({ edge_type: link.edgeType, source_fact_key: link.sourceFactKey })),
          link_counts: counts,
        });
        return;
      }
      const limit = Number(request.query.limit ?? 20) || 20;
      const offset = Number(request.query.offset ?? 0) || 0;
      const excludeDeprecated = request.query.hide_deprecated === "true" || request.query.exclude_deprecated === "true";
      const { facts } = await factStore.list(project.id, {
        search: request.query.search ?? request.query.q,
        category: request.query.category,
        confidence: request.query.confidence,
        excludeDeprecated,
        relatedVulnerabilityId: request.query.related_vulnerability_id,
        limit,
        offset,
      });
      const counts = await factStore.incomingCounts(project.id, facts.map((f) => f.factKey));
      await reply.send(facts.map((f) => factToWire(f, counts.get(f.factKey) ?? 0)));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/projects/:id/facts",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      const body = request.body ?? {};
      const factKey = asString(body.fact_key) || `note-${Math.random().toString(36).slice(2, 6)}`;
      let fact;
      try {
        fact = await factStore.create(project.id, {
          factKey,
          category: asString(body.category) || "note",
          summary: asString(body.summary) ?? "",
          body: asString(body.body) ?? "",
          confidence: asString(body.confidence) || "medium",
          pinned: typeof body.pinned === "boolean" ? body.pinned : false,
          relatedVulnerabilityId: asString(body.related_vulnerability_id) ?? "",
          sourceConversationId: asString(body.source_conversation_id) ?? "",
          sourceMessageId: asString(body.source_message_id) ?? "",
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          await reply.code(409).send({ error: `A fact keyed "${factKey}" already exists in this project` });
          return;
        }
        throw error;
      }
      await reply.send(factToWire(fact, 0));
    },
  );

  app.put<{ Params: { id: string; factId: string }; Body: Record<string, unknown> }>(
    "/api/projects/:id/facts/:factId",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      const body = request.body ?? {};
      const input: UpdateFactInput = {};
      if (body.fact_key !== undefined) input.factKey = asString(body.fact_key) ?? "";
      if (body.category !== undefined) input.category = asString(body.category) ?? "";
      if (body.summary !== undefined) input.summary = asString(body.summary) ?? "";
      if (body.body !== undefined) input.body = asString(body.body) ?? "";
      if (body.confidence !== undefined) input.confidence = asString(body.confidence) ?? "";
      if (typeof body.pinned === "boolean") input.pinned = body.pinned;
      let fact;
      try {
        fact = await factStore.update(project.id, request.params.factId, input);
      } catch (error) {
        if (isUniqueViolation(error)) {
          await reply.code(409).send({ error: "A fact with that key already exists in this project" });
          return;
        }
        throw error;
      }
      if (!fact) {
        await reply.code(404).send({ error: "Fact not found" });
        return;
      }
      await reply.send(factToWire(fact, 0));
    },
  );

  app.delete<{ Params: { id: string; factId: string } }>(
    "/api/projects/:id/facts/:factId",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      if (!(await factStore.delete(project.id, request.params.factId))) {
        await reply.code(404).send({ error: "Fact not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  // Deprecate/restore share one handler shape: {fact_key?, fact_keys?, ids?,
  // confidence?} -- the mock matches keys and ids alike; restore also accepts
  // a confidence to downgrade the restored facts to (the client sends
  // "tentative"). No match is still a success, like the mock.
  async function setFactsDeprecated(
    reply: FastifyReply,
    projectId: string,
    body: Record<string, unknown>,
    deprecated: boolean,
  ): Promise<void> {
    const factKeys = new Set([asString(body.fact_key), ...asStringList(body.fact_keys)].filter((key): key is string => Boolean(key)));
    const ids = new Set(asStringList(body.ids));
    if (factKeys.size === 0 && ids.size === 0) {
      await reply.code(400).send({ error: "Invalid request body" });
      return;
    }
    const confidence = deprecated ? undefined : asString(body.confidence);
    await factStore.setDeprecated(projectId, [...factKeys], [...ids], deprecated, confidence);
    await reply.send({ success: true });
  }

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/projects/:id/facts/deprecate",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      await setFactsDeprecated(reply, project.id, request.body ?? {}, true);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/projects/:id/facts/restore",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      await setFactsDeprecated(reply, project.id, request.body ?? {}, false);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/fact-edges",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      await reply.send((await factStore.listEdges(project.id)).map(edgeToWire));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/projects/:id/fact-edges",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      const body = request.body ?? {};
      const source = asString(body.source_fact_key);
      const target = asString(body.target_fact_key);
      if (!source || !target) {
        await reply.code(400).send({ error: "Invalid request body" });
        return;
      }
      let edge;
      try {
        edge = await factStore.createEdge(project.id, { sourceFactKey: source, targetFactKey: target, edgeType: asString(body.edge_type) });
      } catch (error) {
        if (error instanceof FactNotFoundError) {
          await reply.code(400).send({ error: error.message });
          return;
        }
        throw error;
      }
      await reply.send(edgeToWire(edge));
    },
  );

  app.delete<{ Params: { id: string; edgeId: string } }>(
    "/api/projects/:id/fact-edges/:edgeId",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      if (!(await factStore.deleteEdge(project.id, request.params.edgeId))) {
        await reply.code(404).send({ error: "Fact edge not found" });
        return;
      }
      await reply.send({ success: true });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { exclude_deprecated?: string; view?: string } }>(
    "/api/projects/:id/fact-graph",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      // The graph client omits exclude_deprecated when it wants exclusion and
      // passes "0" to include deprecated facts; `view` is accepted but unused,
      // like the mock. Nodes are bounded at the store (1000 facts) -- a
      // project graph beyond that would be unusable to render anyway.
      const excludeDeprecated = request.query.exclude_deprecated !== "0";
      const { facts, edges } = await factStore.graphRows(project.id, excludeDeprecated);
      await reply.send({
        nodes: facts.map((f) => ({
          id: f.factKey,
          fact_key: f.factKey,
          label: f.factKey,
          summary: f.summary,
          category: f.category,
          type: f.category,
          confidence: f.confidence,
          pinned: f.pinned,
          verification_state: f.verificationState,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.sourceFactKey,
          target: e.targetFactKey,
          type: e.edgeType,
          confidence: e.confidence,
        })),
      });
    },
  );

  // Promotes the conversation's derived attack chain into project facts:
  // one fact per chain node (keyed chain/<type>/<slug>), edges for the
  // chain's links. Idempotent: re-promoting updates the existing facts and
  // reports them as facts_updated, never duplicates.
  app.post<{ Params: { id: string; conversationId: string } }>(
    "/api/projects/:id/promote-attack-chain/:conversationId",
    { preHandler: requireSession },
    async (request, reply) => {
      const project = await findProjectOr404(reply, request.params.id);
      if (!project) return;
      const { conversationId } = request.params;
      const conversation = await conversationStore.findById(conversationId);
      if (!conversation || conversation.projectId !== project.id) {
        await reply.code(404).send({ error: "Conversation not found" });
        return;
      }
      const chain = await attackChainService.get(conversationId);
      const factKeyFor = (nodeId: string): string | null => {
        const node = chain.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return null;
        const slug = node.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/^\.+|\.+$/g, "")
          .slice(0, 80);
        return `chain/${node.type}/${slug || node.id.toLowerCase()}`;
      };
      let factsCreated = 0;
      let factsUpdated = 0;
      let edgesCreated = 0;
      for (const node of chain.nodes) {
        const factKey = factKeyFor(node.id);
        if (!factKey) continue;
        const confidence = node.risk_score >= 60 ? "high" : node.risk_score >= 30 ? "medium" : "low";
        const body = Object.keys(node.metadata).length > 0 ? JSON.stringify(node.metadata) : "";
        const existing = await factStore.findByKey(project.id, factKey);
        if (existing) {
          // Re-deriving a chat visualization cannot rewrite an accepted finding.
          if (existing.verificationState === "verified") continue;
          await factStore.update(project.id, existing.id, {
            summary: node.label,
            body,
            confidence,
            category: node.type,
          });
          factsUpdated += 1;
        } else {
          try { await factStore.create(project.id, {
            factKey,
            category: node.type,
            summary: node.label,
            body,
            confidence,
            sourceConversationId: conversationId,
            verificationSource: "chat-promote",
          }); } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // A concurrent promotion won the unique (projectId, factKey) insert.
            factsUpdated += 1;
            continue;
          }
          factsCreated += 1;
        }
      }
      const existingEdges = new Set(
        (await factStore.listEdges(project.id)).map((edge) => `${edge.sourceFactKey}->${edge.targetFactKey}`),
      );
      for (const edge of chain.edges) {
        const source = factKeyFor(edge.source);
        const target = factKeyFor(edge.target);
        if (!source || !target || existingEdges.has(`${source}->${target}`)) continue;
        await factStore.createEdge(project.id, { sourceFactKey: source, targetFactKey: target, edgeType: "related" });
        existingEdges.add(`${source}->${target}`);
        edgesCreated += 1;
      }
      await reply.send({ success: true, conversation_id: conversationId, facts_created: factsCreated, facts_updated: factsUpdated, edges_created: edgesCreated });
    },
  );
}
