import type { LlmChannelConfig, LlmClient } from "../adapters/llm/client.js";
import { LlmBadResponseError, LlmUnavailableError } from "../adapters/llm/client.js";
import type { RuntimeTransport } from "../adapters/runtime/client.js";
import type { ConversationRecord, ConversationStore } from "../db/conversation-store.js";
import { deriveExecutionsFromMessages } from "./execution-derivation.js";

/** Another derivation for the same conversation is already running (409). */
export class AttackChainConflictError extends Error {
  public readonly statusCode = 409;
  constructor() {
    super("An attack chain for this conversation is already being generated; retry shortly.");
    this.name = "AttackChainConflictError";
  }
}

export interface AttackChainNode {
  id: string;
  type: string;
  label: string;
  risk_score: number;
  tool_call_id: string;
  metadata: Record<string, unknown>;
}

export interface AttackChainEdge {
  id: string;
  source: string;
  target: string;
}

export interface AttackChain {
  nodes: AttackChainNode[];
  edges: AttackChainEdge[];
}

const NODE_TYPES = new Set(["target", "action", "vulnerability"]);
const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_EXECUTIONS = 120;
const MAX_COMPLETION_TOKENS = 2_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SYSTEM_PROMPT = [
  "You reconstruct the attack chain of an authorized penetration-testing conversation from its transcript.",
  'Return ONLY minified JSON of the shape {"nodes":[{"id":"n1","type":"target|action|vulnerability","label":"...","risk_score":0,"tool_call_id":"","metadata":{}}],"edges":[{"source":"n1","target":"n2"}]}.',
  "Rules:",
  "- Nodes are the meaningful steps and findings in chronological order (recon, enumeration, exploitation, post-exploitation).",
  "- 'target' nodes are the assets/scope; 'action' nodes are what the operator or agent did; 'vulnerability' nodes are confirmed or strongly suspected weaknesses.",
  "- risk_score is 0-100: 0 for plain recon, higher for confirmed impact (>=80 critical).",
  "- Set tool_call_id to the exact id of the transcript step that produced the node when one exists, else \"\".",
  "- Edges connect each step to the one it enabled, in order; keep the graph connected.",
  "- Labels are at most 80 characters. No markdown, no commentary, JSON only.",
].join("\n");

/** One transcript entry per line, bounded so the prompt stays a prompt. */
function buildTranscript(messages: unknown[]): string {
  const lines: string[] = [];
  let budget = MAX_TRANSCRIPT_CHARS;
  const executions = deriveExecutionsFromMessages(messages, "", "").slice(0, MAX_EXECUTIONS);
  for (const execution of executions) {
    if (budget <= 0) break;
    const args = JSON.stringify(execution.arguments);
    const result = (execution.result ?? "(pending)").replace(/\s+/g, " ").slice(0, 400);
    const line = `tool_call ${execution.id}: ${execution.toolName}(${args.slice(0, 300)}) -> ${result}`;
    budget -= line.length + 1;
    lines.push(line);
  }
  // Assistant narration between tool calls gives the model the reasoning thread.
  for (const raw of messages) {
    if (budget <= 0) break;
    if (!isRecord(raw)) continue;
    const type = raw.type ?? raw.role;
    if (type !== "ai" && type !== "assistant") continue;
    const content = raw.content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : "")).join("")
      : "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) continue;
    const line = `assistant: ${trimmed.slice(0, 600)}`;
    budget -= line.length + 1;
    lines.push(line);
  }
  return lines.join("\n");
}

function parseChain(text: string): AttackChain {
  // Tolerate markdown fences / prose around the JSON object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new LlmBadResponseError("The model returned no JSON object");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new LlmBadResponseError(`The model returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new LlmBadResponseError("The model's JSON is missing nodes/edges arrays");
  }
  const ids = new Set<string>();
  const nodes: AttackChainNode[] = [];
  for (const raw of parsed.nodes) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.label !== "string") continue;
    const type = typeof raw.type === "string" && NODE_TYPES.has(raw.type) ? raw.type : "action";
    const risk = typeof raw.risk_score === "number" && Number.isFinite(raw.risk_score) ? Math.min(100, Math.max(0, Math.round(raw.risk_score))) : 0;
    const metadata = isRecord(raw.metadata) ? raw.metadata : {};
    ids.add(raw.id);
    nodes.push({
      id: raw.id,
      type,
      label: raw.label.slice(0, 200),
      risk_score: risk,
      tool_call_id: typeof raw.tool_call_id === "string" ? raw.tool_call_id : "",
      metadata,
    });
  }
  const edges: AttackChainEdge[] = [];
  const seen = new Set<string>();
  let edgeIndex = 0;
  for (const raw of parsed.edges) {
    if (!isRecord(raw) || typeof raw.source !== "string" || typeof raw.target !== "string") continue;
    if (!ids.has(raw.source) || !ids.has(raw.target) || raw.source === raw.target) continue;
    const id = typeof raw.id === "string" ? raw.id : `e${++edgeIndex}`;
    const key = `${raw.source}->${raw.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id, source: raw.source, target: raw.target });
  }
  return { nodes, edges };
}

/**
 * Derives a conversation's attack chain with one LLM call over its live
 * thread transcript. The derived chain is cached in memory (single-operator
 * BFF; a restart re-derives on demand) and `regenerate` replaces it. A
 * derivation already in flight makes concurrent GET/regenerate calls fail
 * 409 -- apps/ui-app's chain flow polls and retries on exactly that status.
 */
export class AttackChainService {
  private readonly cache = new Map<string, AttackChain>();
  private readonly inFlight = new Map<string, Promise<AttackChain>>();

  public constructor(
    private readonly conversationStore: ConversationStore,
    private readonly runtime: RuntimeTransport,
    private readonly llm: LlmClient,
    private readonly resolveChannel: () => Promise<LlmChannelConfig | null>,
  ) {}

  public invalidate(conversationId: string): void {
    this.cache.delete(conversationId);
  }

  /** Cached chain when present, otherwise derives. `refresh` forces a new derivation. */
  public async get(conversationId: string, refresh = false): Promise<AttackChain> {
    if (!refresh) {
      const cached = this.cache.get(conversationId);
      if (cached) return cached;
    }
    const pending = this.inFlight.get(conversationId);
    if (pending) throw new AttackChainConflictError();
    const derivation = this.derive(conversationId).finally(() => {
      this.inFlight.delete(conversationId);
    });
    this.inFlight.set(conversationId, derivation);
    return derivation;
  }

  private async derive(conversationId: string): Promise<AttackChain> {
    const conversation = await this.loadConversation(conversationId);
    const state = await this.runtime.getThreadState(conversation.runtimeThreadId);
    const messages = Array.isArray(state.values.messages) ? state.values.messages : [];
    const transcript = buildTranscript(messages);
    if (transcript.length === 0) {
      const empty: AttackChain = { nodes: [], edges: [] };
      this.cache.set(conversationId, empty);
      return empty;
    }
    const channel = await this.resolveChannel();
    if (!channel) throw new LlmUnavailableError("No AI channel is configured (Settings > AI: base_url, api_key and model are required for chain derivation).");
    const completion = await this.llm.complete(channel, SYSTEM_PROMPT, `Conversation: ${conversation.title}\n\nTranscript:\n${transcript}`, MAX_COMPLETION_TOKENS);
    const chain = parseChain(completion);
    this.cache.set(conversationId, chain);
    return chain;
  }

  private async loadConversation(conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.conversationStore.findById(conversationId);
    if (!conversation) {
      const error = new Error("Conversation not found") as Error & { statusCode?: number };
      error.statusCode = 404;
      throw error;
    }
    return conversation;
  }
}
