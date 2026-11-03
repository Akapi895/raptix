// Conversation-level human-in-the-loop (HITL) settings shown in the chat sidebar. The stored shape is the
// browser copy of internal/config HITL settings; the server copy is written through features/hitl.

export const HITL_STORAGE_PREFIX = 'raptix-chat-hitl';
export const HITL_MODE_OFF = 'off';
export const HITL_MODE_APPROVAL = 'approval';
export const HITL_MODE_REVIEW_EDIT = 'review_edit';
export const HITL_MODE_OPTIONS = [HITL_MODE_OFF, HITL_MODE_APPROVAL, HITL_MODE_REVIEW_EDIT] as const;
export const DEFAULT_HITL_TIMEOUT_SECONDS = 300;
export const DEFAULT_HITL_SESSION_TOOL_WHITELIST = 'tool_search, skill, task, write_todos, transfer_to_agent, exit, TaskCreate, TaskGet, TaskUpdate, TaskList, upsert_project';

export type HitlMode = typeof HITL_MODE_OPTIONS[number];
export type HitlReviewer = 'human' | 'audit_agent';

export interface HitlConfig {
  mode: HitlMode;
  reviewer: HitlReviewer;
  sensitiveTools: string;
  timeoutSeconds: number;
  updatedAt: string;
}

/** The server defaults the page received at start-up (window.csaiHitlDefaultConfig and friends). */
export interface HitlServerDefault {
  mode?: string;
  reviewer?: string;
  timeoutSeconds?: unknown;
}

export function normalizeHitlMode(mode: unknown): HitlMode {
  let v = String(mode ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (v === 'feedback' || v === 'followup') v = HITL_MODE_APPROVAL;
  return (HITL_MODE_OPTIONS as readonly string[]).includes(v) ? v as HitlMode : HITL_MODE_OFF;
}

export function normalizeHitlReviewer(value: unknown): HitlReviewer {
  const x = String(value ?? '').trim().toLowerCase();
  return x === 'audit_agent' || x === 'agent' || x === 'ai' ? 'audit_agent' : 'human';
}

export function normalizeHitlTimeout(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(86400, Math.round(n)));
}

/** Server default, with the built-in fallbacks when the server did not send one. */
export function defaultHitlConfig(serverDefault: HitlServerDefault | null | undefined, serverReviewer?: string): HitlConfig {
  const server = serverDefault ?? {};
  return {
    mode: normalizeHitlMode(server.mode || HITL_MODE_OFF),
    reviewer: normalizeHitlReviewer(server.reviewer || serverReviewer || 'human'),
    sensitiveTools: DEFAULT_HITL_SESSION_TOOL_WHITELIST,
    timeoutSeconds: normalizeHitlTimeout(server.timeoutSeconds, DEFAULT_HITL_TIMEOUT_SECONDS),
    updatedAt: '',
  };
}

/** Splits a comma- or line-separated tool list, as the textarea shows it. */
export function splitTools(text: string): string[] {
  return String(text ?? '').split(/[,\n\r]+/).map(x => x.trim()).filter(Boolean);
}

/** Global allowlist entries first, then the session's, without repeats (case-insensitive). */
export function mergeToolsForDisplay(globalTools: readonly string[] | undefined, sessionTools: readonly string[] | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tool: unknown) => {
    const name = String(tool ?? '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  globalTools?.forEach(add);
  sessionTools?.forEach(add);
  return out.join(', ');
}

/** Drops the global allowlist from what the form holds, so a conversation does not store it twice. */
export function stripGlobalTools(globalTools: readonly string[] | undefined, text: string): string {
  if (!globalTools || globalTools.length === 0) return String(text ?? '').trim();
  const globalKeys = new Set(globalTools.map(t => String(t ?? '').trim().toLowerCase()).filter(Boolean));
  return splitTools(text).filter(part => !globalKeys.has(part.toLowerCase())).join(', ');
}

export function storageKeyFor(conversationId: string | null | undefined): string {
  return `${HITL_STORAGE_PREFIX}:${String(conversationId ?? '').trim()}`;
}

/** Reads a stored conversation config. Anything unreadable is the fallback. */
export function parseStoredConfig(raw: string | null, fallback: HitlConfig): HitlConfig {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<HitlConfig> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      mode: normalizeHitlMode(parsed.mode),
      reviewer: normalizeHitlReviewer(parsed.reviewer),
      sensitiveTools: typeof parsed.sensitiveTools === 'string' ? parsed.sensitiveTools : fallback.sensitiveTools,
      timeoutSeconds: normalizeHitlTimeout(parsed.timeoutSeconds, fallback.timeoutSeconds),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return fallback;
  }
}

/** The shape written to storage, with every field normalised. */
export function serialiseConfig(cfg: Partial<HitlConfig> | null | undefined): HitlConfig {
  return {
    mode: normalizeHitlMode(cfg?.mode),
    reviewer: normalizeHitlReviewer(cfg?.reviewer),
    sensitiveTools: typeof cfg?.sensitiveTools === 'string' ? cfg.sensitiveTools : '',
    timeoutSeconds: normalizeHitlTimeout(cfg?.timeoutSeconds, DEFAULT_HITL_TIMEOUT_SECONDS),
    updatedAt: typeof cfg?.updatedAt === 'string' ? cfg.updatedAt : '',
  };
}

/** The value the session field should show: the stored list, or the baseline when there is none. */
export function sessionToolsForUI(cfg: HitlConfig): string {
  return typeof cfg.sensitiveTools === 'string' && cfg.sensitiveTools.trim()
    ? cfg.sensitiveTools.trim()
    : DEFAULT_HITL_SESSION_TOOL_WHITELIST;
}

export function modeLabelKey(mode: HitlMode): string {
  switch (mode) {
    case HITL_MODE_APPROVAL: return 'chat.hitlModeApproval';
    case HITL_MODE_REVIEW_EDIT: return 'chat.hitlModeReviewEdit';
    default: return 'chat.hitlModeOff';
  }
}
