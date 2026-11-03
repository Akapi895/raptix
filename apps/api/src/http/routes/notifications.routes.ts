import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { ReadNotificationStore } from "../../db/read-notification-store.js";
import type { VulnerabilityStore } from "../../db/vulnerability-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface NotificationRoutesOptions {
  authStore: AuthStore;
  vulnerabilityStore: VulnerabilityStore;
  readNotificationStore: ReadNotificationStore;
}

/**
 * Notifications are derived live from real Vulnerability records (new
 * findings), the same "derive, don't store a parallel feed" approach
 * Tier 5 used for MCP monitor executions. This is a deliberately narrow
 * slice of apps/ui-app's NotificationItem contract -- there is no event
 * bus or pub-sub anywhere in apps/api, so HITL/execution-failure/session
 * notifications (the other id fields the wire type carries:
 * executionId/interruptId/sessionId) have no source to derive from yet.
 * Real as far as it goes, not a full product notification feed.
 */
export function registerNotificationRoutes(app: FastifyInstance, options: NotificationRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { vulnerabilityStore, readNotificationStore } = options;

  app.get("/api/notifications/summary", { preHandler: requireSession }, async (request: FastifyRequest) => {
    const query = request.query as { since?: string; limit?: string };
    const since = Number(query.since) || 0;
    const limit = Math.max(1, Number(query.limit) || 80);

    const [{ vulnerabilities }, readIds] = await Promise.all([
      vulnerabilityStore.list({ limit, offset: 0 }),
      readNotificationStore.listRead(),
    ]);

    const items = vulnerabilities
      .filter((vuln) => vuln.createdAt.getTime() > since)
      .map((vuln) => {
        const id = `vuln-${vuln.id}`;
        return {
          id,
          level: vuln.severity,
          type: "vulnerability",
          title: vuln.title,
          desc: vuln.description,
          ts: vuln.createdAt.toISOString(),
          actionable: true,
          read: readIds.has(id),
          vulnerabilityId: vuln.id,
        };
      });

    return {
      items,
      unreadCount: items.filter((item) => !item.read).length,
      sinceMs: since,
      generatedAt: new Date().toISOString(),
    };
  });

  app.post("/api/notifications/read", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { eventIds?: string[] } | undefined;
    if (!Array.isArray(body?.eventIds)) {
      await reply.code(400).send({ error: "eventIds must be an array" });
      return;
    }
    await readNotificationStore.markRead(body.eventIds);
    return { success: true };
  });
}
