import type { FastifyInstance } from "fastify";
import type { SandboxFilesTransport } from "../../adapters/sandbox/client.js";
import type { AuthStore } from "../../db/auth-store.js";
import type { ProjectRecord, ProjectStore } from "../../db/project-store.js";
import { createRequireSession } from "../plugins/auth-guard.js";

export interface HitlRoutesOptions {
  authStore: AuthStore;
  projectStore: ProjectStore;
  sandbox: SandboxFilesTransport;
}

interface PendingQuery {
  page?: string;
  pageSize?: string;
}

interface DecisionBody {
  interruptId?: unknown;
  decision?: unknown;
  comment?: unknown;
  editedArguments?: unknown;
}

const REQUESTS_PATH = "approvals/requests.jsonl";
const DECISIONS_PATH = "approvals/decisions.jsonl";

interface ApprovalRequestLine {
  kind: "approval_request";
  request_id: string;
  engagement_name?: string;
  agent_name?: string;
  tool_name?: string;
  tool_args_redacted?: unknown;
  reason?: string;
  created_at?: number;
}

function parseJsonLines(raw: Buffer | null): unknown[] {
  if (!raw) return [];
  return raw
    .toString("utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null && typeof value === "object");
}

async function decidedRequestIds(sandbox: SandboxFilesTransport, workspaceSlug: string): Promise<Set<string>> {
  const raw = await sandbox.read(workspaceSlug, DECISIONS_PATH);
  const ids = new Set<string>();
  for (const line of parseJsonLines(raw)) {
    const record = line as Record<string, unknown>;
    if (record.kind === "approval_decision" && typeof record.request_id === "string") ids.add(record.request_id);
  }
  return ids;
}

/** One project's pending approval requests -- never throws; an unreachable sandbox just contributes nothing. */
async function pendingForProject(sandbox: SandboxFilesTransport, project: ProjectRecord): Promise<{ project: ProjectRecord; request: ApprovalRequestLine }[]> {
  try {
    const [requestsRaw, decided] = await Promise.all([
      sandbox.read(project.workspaceSlug, REQUESTS_PATH),
      decidedRequestIds(sandbox, project.workspaceSlug),
    ]);
    const requests = parseJsonLines(requestsRaw).filter(
      (line): line is ApprovalRequestLine =>
        (line as Record<string, unknown>).kind === "approval_request" && typeof (line as Record<string, unknown>).request_id === "string",
    );
    const seen = new Set<string>();
    const pending: { project: ProjectRecord; request: ApprovalRequestLine }[] = [];
    for (const request of requests) {
      if (decided.has(request.request_id) || seen.has(request.request_id)) continue;
      seen.add(request.request_id);
      pending.push({ project, request });
    }
    return pending;
  } catch {
    return [];
  }
}

/** Scans every active project's sandbox for a pending request with this id. Correctness over speed: decide/dismiss are low-frequency, human-driven actions. */
async function findPendingRequest(
  projectStore: ProjectStore,
  sandbox: SandboxFilesTransport,
  requestId: string,
): Promise<ProjectRecord | null> {
  const { projects } = await projectStore.list({ status: "active", limit: 500, offset: 0 });
  const results = await Promise.all(projects.map((project) => pendingForProject(sandbox, project)));
  for (const pending of results) {
    if (pending.some((entry) => entry.request.request_id === requestId)) return pending[0]!.project;
  }
  return null;
}

async function writeDecision(
  sandbox: SandboxFilesTransport,
  workspaceSlug: string,
  args: { requestId: string; action: "allow" | "deny" | "redirect"; operatorNote: string; redirectArgs: unknown },
): Promise<void> {
  const line = JSON.stringify({
    kind: "approval_decision",
    request_id: args.requestId,
    action: args.action,
    operator_note: args.operatorNote,
    redirect_args: args.redirectArgs ?? null,
    decided_at: Date.now() / 1000,
  });
  await sandbox.append(workspaceSlug, DECISIONS_PATH, Buffer.from(`${line}\n`, "utf-8"));
}

/**
 * Raptix's real HITL approval gate (packages/raptix/raptix/middleware/hitl.py,
 * HITLApprovalMiddleware) does not use a LangGraph thread interrupt: it pauses
 * synchronously inside the tool call and exchanges `ApprovalRequest`/
 * `ApprovalDecision` records as JSONL lines in the *project's own sandbox*
 * (`approvals/requests.jsonl` / `approvals/decisions.jsonl`, via `ProjectFiles`
 * -- ADR-0102). Tier 2/4's sandbox-routing retrofit (agent-loop.routes.ts's
 * `createRun`/streaming now passes `configurable.sandbox_url`/`sandbox_token`
 * per project) closed the gap that used to block this, so `pending`/
 * `decision`/`dismiss` are real here, not stubs.
 *
 * One real limitation, not fixable from this side: `ApprovalRequest` carries
 * `engagement_name` (the project's workspaceSlug) but no conversation or
 * thread id (`middleware/hitl.py::_build_request` never sets one) -- there is
 * structurally no way to say which conversation a pending approval belongs
 * to. Every item here omits `conversationId`. The global pending list
 * (dashboard, mobile summary, the HITL page) is fully real; the inline
 * "resolve this in the chat you're looking at" card
 * (`features/chat/hitl-inline/restore.ts`'s `?conversationId=` filter) will
 * never match anything until the Python middleware is extended to record one
 * -- a runtime change, out of scope here.
 */
export function registerHitlRoutes(app: FastifyInstance, options: HitlRoutesOptions): void {
  const requireSession = createRequireSession(options.authStore);
  const { projectStore, sandbox } = options;

  app.get<{ Querystring: PendingQuery }>("/api/hitl/pending", { preHandler: requireSession }, async (request) => {
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(request.query.pageSize) || 20));
    const { projects } = await projectStore.list({ status: "active", limit: 500, offset: 0 });
    const perProject = await Promise.all(projects.map((project) => pendingForProject(sandbox, project)));
    const all = perProject.flat().sort((a, b) => (b.request.created_at ?? 0) - (a.request.created_at ?? 0));
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize).map(({ project, request: req }) => ({
      id: req.request_id,
      toolName: req.tool_name ?? "",
      mode: "approval",
      status: "pending",
      reviewer: "human",
      createdAt: new Date((req.created_at ?? 0) * 1000).toISOString(),
      payload: JSON.stringify({
        argumentsObj: req.tool_args_redacted ?? {},
        userMessage: project.name ? `[${project.name}] ${req.reason ?? ""}` : req.reason ?? "",
      }),
    }));
    return { items, total: all.length };
  });

  app.post<{ Body: DecisionBody }>("/api/hitl/decision", { preHandler: requireSession }, async (request, reply) => {
    const requestId = typeof request.body.interruptId === "string" ? request.body.interruptId : "";
    if (!requestId) return reply.code(400).send({ error: "interruptId is required" });
    const decision = request.body.decision === "reject" ? "reject" : "approve";
    const comment = typeof request.body.comment === "string" ? request.body.comment : "";
    const editedArguments =
      request.body.editedArguments && typeof request.body.editedArguments === "object" ? request.body.editedArguments : null;

    const project = await findPendingRequest(projectStore, sandbox, requestId);
    if (!project) return reply.code(409).send({ error: "already resolved" });

    await writeDecision(sandbox, project.workspaceSlug, {
      requestId,
      action: decision === "reject" ? "deny" : editedArguments ? "redirect" : "allow",
      operatorNote: comment,
      redirectArgs: editedArguments,
    });
    return { success: true, decision };
  });

  app.post<{ Body: DecisionBody }>("/api/hitl/dismiss", { preHandler: requireSession }, async (request, reply) => {
    const requestId = typeof request.body.interruptId === "string" ? request.body.interruptId : "";
    if (!requestId) return reply.code(400).send({ error: "interruptId is required" });

    const project = await findPendingRequest(projectStore, sandbox, requestId);
    if (!project) return reply.code(409).send({ error: "already resolved" });

    // Dismiss has no "leave it alone" equivalent on the agent side: the tool
    // call is still blocked waiting on a decision (or it already timed out
    // and defaulted to deny). Writing a deny is the only safe choice --
    // never leave a gated tool call ambiguously open because the operator
    // closed the notification instead of clicking Reject.
    await writeDecision(sandbox, project.workspaceSlug, {
      requestId,
      action: "deny",
      operatorNote: "dismissed by operator",
      redirectArgs: null,
    });
    return { success: true, decision: "dismiss" };
  });
}
