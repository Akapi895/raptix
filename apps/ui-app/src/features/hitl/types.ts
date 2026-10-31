import type { KeyValueStorage } from '../../platform/storage';

export type HitlMode = 'off' | 'approval' | 'review_edit';
export type HitlReviewer = 'human' | 'audit_agent';
export type HitlDecision = 'approve' | 'reject';
export type AuditBackend = 'openai' | 'typesafe';
export type JsonObject = Record<string, unknown>;
export type Translate = (key: string, params?: Record<string, unknown>) => string;
export type ApiFetch = (url: string, options?: RequestInit) => Promise<Response>;
// JSON names follow handler.HITLRequest and hitlInterruptRowToMap.
export interface HitlConfig {
  enabled?: boolean;
  mode: string;
  reviewer: string;
  sensitiveTools: string | string[];
  timeoutSeconds: number;
}
export interface HitlDefaults {
  mode: HitlMode;
  reviewer: HitlReviewer;
  timeoutSeconds: number;
  auditBackend?: AuditBackend;
  auditModel?: string;
}
export interface HitlItem {
  id: string;
  conversationId?: string;
  messageId?: string;
  toolName?: string;
  toolCallId?: string;
  mode?: string;
  payload?: unknown;
  status?: string;
  reviewer?: string;
  decision?: string;
  comment?: string;
  decidedBy?: string;
  decided_by?: string;
  auditBackend?: string;
  audit_backend?: string;
  auditModel?: string;
  audit_model?: string;
  createdAt?: string;
  decidedAt?: string | null;
}
export interface WorkflowRun {
  id: string;
  conversation_id?: string;
  conversationId?: string;
  workflow_id?: string;
  workflowId?: string;
  pending_hitl_json?: string;
  pendingHitlJson?: string;
  pending_hitl_node_id?: string;
  pendingHitlNodeId?: string;
}
export interface HitlStrategy {
  auditAgentPrompt?: string;
  auditAgentPromptReviewEdit?: string;
  defaultAuditAgentPrompt?: string;
  defaultAuditAgentPromptReviewEdit?: string;
}
export interface HitlFilters { q?: string; decision?: string; decidedBy?: string }
export type HitlTab = 'pending' | 'logs' | 'policy';
export type HitlList = 'pending' | 'logs';
export interface HitlPage<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
  loaded: boolean;
}
export interface HitlState {
  tab: HitlTab;
  strategyMode: 'approval' | 'review_edit';
  strategy: HitlStrategy;
  pending: HitlPage<HitlItem> & { runs: WorkflowRun[]; q: string };
  logs: HitlPage<HitlItem> & { filters: HitlFilters; retentionDays: number };
  selectedLogs: ReadonlySet<string>;
}
export interface HitlDependencies {
  request: ApiFetch;
  storage: KeyValueStorage;
  translate: Translate;
  getLocale(): string;
  getCurrentConversationId(): string;
  getConversationConfig?(id: string): HitlConfig | null;
  saveConversationConfigLocally?(id: string, config: HitlConfig): void;
  applyConfigToUI?(config: HitlConfig): void;
  readConfigFromForm?(): HitlConfig;
  updateStatusUI?(config: HitlConfig): void;
  refreshConfigByCurrentConversation?(): void;
  setReviewerUI?(reviewer: string): void;
  bindReviewerToggleListeners?(): void;
  defaultsChanged?(defaults: HitlDefaults, whitelist: string[] | null): void;
  getExternalState?(): { auditBackend?: string; auditModel?: string; whitelist?: string[] };
  attachRunningTaskEventStream?(id: string): Promise<boolean>;
  refreshLastAssistantProcessDetails?(id: string): Promise<void>;
  loadConversation?(id: string): void | Promise<void>;
  loadActiveTasks?(): void | Promise<void>;
  submitWorkflowDecision?(id: string, approved: boolean, comment: string): Promise<void>;
  navigate?(page: string): void;
  currentPage?(): string;
  initPaginationSelects?(root: HTMLElement): void;
  alert(message: string): void;
  confirm(message: string): boolean;
  now(): number;
  sleep(ms: number): Promise<void>;
}
