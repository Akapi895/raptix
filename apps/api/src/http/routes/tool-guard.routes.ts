import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore } from "../../db/auth-store.js";
import type { GuardRuleRecord, ToolGuardStore } from "../../db/tool-guard-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface ToolGuardRoutesOptions {
  authStore: AuthStore;
  toolGuardStore: ToolGuardStore;
}

function toWire(rule: GuardRuleRecord) {
  return { id: rule.id, name: rule.name, enabled: rule.enabled, pattern: rule.pattern, message: rule.message };
}

function rulesFromBody(body: unknown): GuardRuleRecord[] {
  const raw = (body as { rules?: unknown[] } | undefined)?.rules;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((rule): rule is Record<string, unknown> => typeof rule === "object" && rule !== null)
    .map((rule, index) => ({
      id: typeof rule.id === "string" && rule.id ? rule.id : `rule-${index}`,
      name: typeof rule.name === "string" ? rule.name : "",
      enabled: rule.enabled === true,
      pattern: typeof rule.pattern === "string" ? rule.pattern : "",
      message: typeof rule.message === "string" ? rule.message : "",
    }));
}

/**
 * Patterns are matched with Node's RegExp, not RE2 -- apps/ui-app's own
 * model.ts says "the backend (RE2) stays the authority for pattern syntax",
 * but there is no RE2 binding in this stack. Documented deviation: an
 * operator-authored pattern here runs with backtracking semantics (and a
 * ReDoS pattern is a self-inflicted risk on the operator's own config, not
 * attacker-controlled input). This endpoint also only *tests* a rule set
 * against a sample tool call -- it is not wired into the live agent
 * tool-call path (no enforcement integration exists yet).
 */
function testRules(rules: GuardRuleRecord[], toolName: string, toolArguments: Record<string, unknown>) {
  const haystack = `${toolName} ${JSON.stringify(toolArguments)}`;
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern);
    } catch {
      continue;
    }
    const match = regex.exec(haystack);
    if (match) {
      return { blocked: true, match: { ruleId: rule.id, ruleName: rule.name, matchedText: match[0], message: rule.message } };
    }
  }
  return { blocked: false, match: null };
}

export function registerToolGuardRoutes(app: FastifyInstance, options: ToolGuardRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { toolGuardStore } = options;

  app.get("/api/tool-guard", { preHandler: requireSession }, async () => {
    const config = await toolGuardStore.get();
    return { enabled: config.enabled, rules: config.rules.map(toWire) };
  });

  app.put("/api/tool-guard", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { enabled?: boolean } | undefined;
    if (typeof body?.enabled !== "boolean") {
      await reply.code(400).send({ error: "enabled is required" });
      return;
    }
    const rules = rulesFromBody(request.body);
    const saved = await toolGuardStore.set({ enabled: body.enabled, rules });
    return { enabled: saved.enabled, rules: saved.rules.map(toWire) };
  });

  app.post("/api/tool-guard/test", { preHandler: requireSession }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { toolName?: string; arguments?: Record<string, unknown> } | undefined;
    if (!body?.toolName) {
      await reply.code(400).send({ error: "toolName is required" });
      return;
    }
    const config = await toolGuardStore.get();
    return testRules(config.rules, body.toolName, body.arguments ?? {});
  });
}
