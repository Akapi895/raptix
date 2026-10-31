import type { Project, ProjectFact, ProjectQuery } from '../../api/types/project';
import type { Asset } from '../../api/types/asset';
import type { Conversation } from '../../api/types/conversation';
import type { FactGraph } from '../fact-graph';
export type { Project, ProjectQuery, Asset };
// Go factWithLinksResponse and ProjectFactEdge, internal/handler/project.go.
export interface FactLink { edge_type?: string; source_fact_key?: string; type?: string; from?: string }
export type Fact = ProjectFact & { incoming_links?: FactLink[]; link_counts?: { incoming?: number; outgoing?: number } };
export interface FactInput {
  fact_key: string; category: string; summary: string; body: string; confidence: string;
  pinned?: boolean; related_vulnerability_id?: string; links_text?: string;
}
export interface Stats { fact_count: number; vuln_count: number; conversation_count: number; sparse_fact_count: number }
export interface Promotion { facts_created: number; facts_updated: number; edges_created: number }
// Conversation timestamps are camelCase in Go; snake_case is accepted only at
// the transitional mock boundary, matching the previous renderer.
export type ProjectConversation = Conversation & { project_id?: string; updated_at?: string; created_at?: string; agent_mode?: string; role_name?: string };
// internal/agentloop/manager.go task summaries and handler HITL pending items.
export interface TaskSummary { conversationId: string; status?: string; completedAt?: string }
export interface Approval {
  id?: string; interruptId?: string; conversationId?: string; status?: string;
  reviewer?: string; decidedBy?: string; decided_by?: string;
  createdAt?: string; expiresAt?: string; timeoutSeconds?: number;
  payload?: string | { hitlApproval?: { timeoutSeconds?: number; createdAt?: string; expiresAt?: string } };
}
export interface VulnerabilitySummary { id: string; title: string; severity: string; status: string }
export interface ParsedProjects { items: Project[]; total: number; limit: number; offset: number; isLegacyArray: boolean }
export interface ListOptions { page?: number; pageSize?: number; search?: string }
export type ProjectTab = 'facts' | 'graph' | 'assets' | 'conversations' | 'vulns' | 'settings';
export type PickerKey = 'chat' | 'webshell';
export type Translate = (key: string, options?: Record<string, unknown>) => string;
export interface PickerConfig {
  listId: string; searchInputId: string; getSelectedId(): string;
  onSelect(id: string): void | Promise<void>; t?: Translate;
}
export interface ModalOptions { focus?: boolean }
export interface ProjectsDependencies {
  translate: Translate;
  hasPermission(permission: string): boolean;
  requirePermission(permission: string, message?: string): boolean;
  applyRBAC(root: HTMLElement): void;
  openModal(id: string, options?: ModalOptions): void;
  closeModal(id: string): void;
  isModalOpen(id: string): boolean;
  syncModalBodyLock(): void;
  deferModalContent(callback: () => void): void;
  notify(message: string, kind?: string): void;
  notifyApiError(message: string, kind?: string): void;
  refreshProjectFilters(): void | Promise<void>;
  refreshConversationProjectFilter(): void;
  getConversationId(): string;
  getConversationProjectId(): string;
  setConversationProjectId(id: string): void;
  onConversationProjectBindingChanged(id: string): void;
  refreshChatWelcomeEmptyState(): void;
  loadConversation(id: string): void | Promise<void>;
  startNewConversation(options: { projectId: string }): void | Promise<void>;
  openConversationContextMenu(event: MouseEvent, id: string, title: string): void;
  closeOtherChatPanels(): void;
  closeWebshellProjectPanel(): void;
  applyWebshellProjectSelection(id: string): void | Promise<void>;
  navigate(page: string): void;
  setVulnerabilityProjectFilter(id: string): boolean;
  setVulnerabilityIdFilter(id: string): void;
  openAssetDetail(asset: Asset): void;
  initPaginationSelects(root: HTMLElement): void;
  formatProjectName(name: string): string;
  applyProjectName(element: HTMLElement, name: string, fallback?: string): void;
}
export interface ProjectsSnapshot {
  projects: Project[]; allProjects: Project[]; selectedId: string; project: Project | null;
  tab: ProjectTab; page: number; pageSize: number; total: number; search: string;
  assets: Asset[]; assetsPage: number; assetsPageSize: number; assetsTotal: number; assetsTotalPages: number;
  graph: FactGraph | null;
}
