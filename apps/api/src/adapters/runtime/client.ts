import { RuntimeRejectedError, RuntimeUnavailableError } from "./errors.js";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface RuntimeRun {
  runId: string;
  threadId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface RuntimeClientOptions {
  apiUrl: string;
  apiToken?: string;
  timeoutMs?: number;
}

/** Port routes depend on (matches AuthStore/ProjectStore/ConversationStore) -- RuntimeClient implements it; tests use a fake. */
export interface RuntimeTransport {
  ping(): Promise<{ version: string; graphIds: readonly string[] }>;
  createThread(threadId: string, metadata?: Record<string, string>): Promise<{ threadId: string; metadata: Record<string, unknown> }>;
  getThread(threadId: string): Promise<{ threadId: string; metadata: Record<string, unknown>; status?: string }>;
  getThreadState(threadId: string): Promise<{ values: Record<string, unknown>; tasks: unknown[] }>;
  createRun(threadId: string, assistantId: string, input: Record<string, unknown>, requestId: string): Promise<RuntimeRun>;
  getRun(threadId: string, runId: string): Promise<RuntimeRun>;
  listRuns(threadId: string, offset?: number, limit?: number): Promise<RuntimeRun[]>;
  cancelRun(threadId: string, runId: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toRun(value: unknown, threadId: string): RuntimeRun {
  if (
    !isRecord(value) ||
    value.thread_id !== threadId ||
    typeof value.run_id !== "string" ||
    typeof value.status !== "string" ||
    !isRecord(value.metadata) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new RuntimeUnavailableError("Malformed run payload from runtime");
  }
  return {
    runId: value.run_id,
    threadId,
    status: value.status,
    createdAt: new Date(value.created_at).toISOString(),
    updatedAt: new Date(value.updated_at).toISOString(),
    metadata: value.metadata,
  };
}

/**
 * Thin HTTP client for the LangGraph API
 * (packages/raptix/raptix/interfaces/api/): /info, /assistants, /threads,
 * /threads/:id/runs. Holds the runtime token -- apps/ui-app never does (see
 * token.ts). Tier 2 builds the domain routes (Projects, chat, HITL) on top
 * of this; Tier 1 only needs the client itself to exist and work.
 */
export class RuntimeClient implements RuntimeTransport {
  private readonly apiUrl: string;
  private readonly apiToken: string | undefined;
  private readonly timeoutMs: number;

  public constructor(options: RuntimeClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.apiToken = options.apiToken;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async fetchJson(
    path: string,
    body?: unknown,
    method: "GET" | "POST" = body === undefined ? "GET" : "POST",
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (this.apiToken) headers.authorization = `Bearer ${this.apiToken}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      if ([400, 404, 409, 422].includes(response.status)) {
        throw new RuntimeRejectedError(response.status === 422 ? 400 : response.status);
      }
      if (!response.ok) throw new RuntimeUnavailableError(`Runtime returned HTTP ${response.status}`);
      if (response.status === 204) return null;
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new RuntimeUnavailableError("Runtime response too large");
      return text.length > 0 ? JSON.parse(text) : null;
    } catch (error) {
      if (error instanceof RuntimeRejectedError || error instanceof RuntimeUnavailableError) throw error;
      throw new RuntimeUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  /** `/info` plus one page of `/assistants/search` -- enough to prove the runtime is reachable and authenticated. */
  public async ping(): Promise<{ version: string; graphIds: readonly string[] }> {
    const info = await this.fetchJson("/info");
    if (!isRecord(info) || typeof info.version !== "string") {
      throw new RuntimeUnavailableError("Malformed /info payload");
    }
    const page = await this.fetchJson("/assistants/search", { limit: 100, offset: 0 });
    if (!Array.isArray(page)) throw new RuntimeUnavailableError("Malformed /assistants/search payload");
    const graphIds = new Set<string>();
    for (const assistant of page) {
      if (isRecord(assistant) && typeof assistant.graph_id === "string") graphIds.add(assistant.graph_id);
    }
    return { version: info.version, graphIds: [...graphIds].sort() };
  }

  public async createThread(
    threadId: string,
    metadata: Record<string, string> = {},
  ): Promise<{ threadId: string; metadata: Record<string, unknown> }> {
    const value = await this.fetchJson("/threads", { thread_id: threadId, if_exists: "raise", metadata });
    if (!isRecord(value) || value.thread_id !== threadId || !isRecord(value.metadata)) {
      throw new RuntimeUnavailableError();
    }
    return { threadId, metadata: value.metadata };
  }

  public async getThread(
    threadId: string,
  ): Promise<{ threadId: string; metadata: Record<string, unknown>; status?: string }> {
    const value = await this.fetchJson(`/threads/${encodeURIComponent(threadId)}`);
    if (!isRecord(value) || value.thread_id !== threadId || !isRecord(value.metadata)) {
      throw new RuntimeUnavailableError();
    }
    return {
      threadId,
      metadata: value.metadata,
      ...(typeof value.status === "string" ? { status: value.status } : {}),
    };
  }

  /** `/threads/:id/state`: the checkpoint values (including `messages`) plus any pending tasks. */
  public async getThreadState(threadId: string): Promise<{ values: Record<string, unknown>; tasks: unknown[] }> {
    const value = await this.fetchJson(`/threads/${encodeURIComponent(threadId)}/state`);
    if (!isRecord(value) || !isRecord(value.values)) throw new RuntimeUnavailableError();
    return { values: value.values, tasks: Array.isArray(value.tasks) ? value.tasks : [] };
  }

  public async createRun(
    threadId: string,
    assistantId: string,
    input: Record<string, unknown>,
    requestId: string,
  ): Promise<RuntimeRun> {
    return toRun(
      await this.fetchJson(`/threads/${encodeURIComponent(threadId)}/runs`, {
        assistant_id: assistantId,
        input,
        metadata: { ui_request_id: requestId },
        multitask_strategy: "reject",
        if_not_exists: "reject",
      }),
      threadId,
    );
  }

  public async getRun(threadId: string, runId: string): Promise<RuntimeRun> {
    const found = toRun(
      await this.fetchJson(`/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`),
      threadId,
    );
    if (found.runId !== runId) throw new RuntimeUnavailableError();
    return found;
  }

  public async listRuns(threadId: string, offset = 0, limit = 20): Promise<RuntimeRun[]> {
    const rows = await this.fetchJson(`/threads/${encodeURIComponent(threadId)}/runs?offset=${offset}&limit=${limit}`);
    if (!Array.isArray(rows)) throw new RuntimeUnavailableError();
    return rows.map((row) => toRun(row, threadId));
  }

  public async cancelRun(threadId: string, runId: string): Promise<void> {
    await this.fetchJson(
      `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel?wait=1&action=interrupt`,
      undefined,
      "POST",
    );
  }
}
