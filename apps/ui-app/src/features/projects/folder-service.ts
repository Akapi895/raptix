import type { ProjectsService } from './service';
import { storage, type KeyValueStorage } from '../../platform/storage';
import type { Approval, ProjectConversation, TaskSummary } from './types';

const SEEN = 'raptix-project-folder-completion-seen';
const running = (task: TaskSummary) => task.conversationId && !['completed', 'failed', 'timeout', 'cancelled'].includes((task.status || '').toLowerCase());
export function isHumanProjectPendingApproval(item: Approval): boolean {
  return !['audit_agent', 'agent', 'ai'].includes((item.reviewer || item.decidedBy || item.decided_by || '').trim().toLowerCase()) && (item.status || '').trim().toLowerCase() !== 'audit_running';
}
export function getProjectApprovalTiming(details: Approval = {}) {
  let payload = details.payload;
  if (typeof payload === 'string') { try { const parsed: unknown = JSON.parse(payload); payload = parsed && typeof parsed === 'object' ? parsed : {}; } catch { payload = {}; } }
  const approval = typeof payload === 'object' ? payload.hitlApproval ?? {} : {};
  const timeout = Number(details.timeoutSeconds ?? approval.timeoutSeconds), timeoutSeconds = Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 0;
  const createdAt = Date.parse(details.createdAt || approval.createdAt || '');
  let expiresAt = Date.parse(details.expiresAt || approval.expiresAt || '');
  if (!Number.isFinite(expiresAt) && timeoutSeconds && Number.isFinite(createdAt)) expiresAt = createdAt + timeoutSeconds * 1000;
  return { timeoutSeconds, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}
export function sortProjectFolderConversations(conversations: ProjectConversation[]): ProjectConversation[] {
  const time = (item: ProjectConversation) => Date.parse(item.updatedAt || item.updated_at || item.createdAt || item.created_at || '') || 0;
  return [...conversations].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || time(b) - time(a));
}
export function createProjectFoldersService(projects: ProjectsService, persistence: KeyValueStorage = storage) {
  const state = { ready: false, conversations: [] as ProjectConversation[], runningIds: new Set<string>(), completed: new Map<string, TaskSummary>(), pending: new Map<string, Approval>() };
  let sequence = 0;
  function readSeen(): Record<string, string> {
    try { const parsed: unknown = JSON.parse(persistence.get(SEEN) ?? '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}; return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); } catch { return {}; }
  }
  function isUnread(id: string): boolean {
    const task = state.completed.get(id); if (task?.status?.toLowerCase() !== 'completed') return false;
    const completed = Date.parse(task.completedAt || ''), seen = Date.parse(readSeen()[id] || '');
    return Number.isFinite(completed) && (!Number.isFinite(seen) || completed > seen);
  }
  function markViewed(id: string): boolean { if (!id || !isUnread(id)) return false; const seen = readSeen(); seen[id] = state.completed.get(id)?.completedAt || new Date().toISOString(); persistence.set(SEEN, JSON.stringify(seen)); return true; }
  function syncApprovals(items: Approval[]) {
    state.pending = new Map();
    for (const item of items) { const id = item.conversationId?.trim(); if (id && isHumanProjectPendingApproval(item) && state.runningIds.has(id) && !state.pending.has(id)) state.pending.set(id, item); }
  }
  async function load() {
    const seq = ++sequence;
    const [conversations, active, completed, pending] = await Promise.all([
      projects.api.folderConversations(), projects.api.activeTasks().catch(() => ({ tasks: [] })), projects.api.completedTasks().catch(() => ({ tasks: [] })), projects.api.pending().catch(() => ({ items: [] })),
    ]);
    if (seq !== sequence) return false;
    state.conversations = Array.isArray(conversations) ? conversations : conversations.conversations ?? conversations.items ?? [];
    state.runningIds = new Set(active.tasks.filter(running).map(task => task.conversationId));
    state.completed = new Map(); for (const task of completed.tasks) if (task.conversationId && !state.completed.has(task.conversationId)) state.completed.set(task.conversationId, task);
    syncApprovals(pending.items); state.ready = true; return true;
  }
  return { state, load, isUnread, markViewed, syncApprovals,
    updateTasks(tasks: TaskSummary[]) { const next = new Set(tasks.filter(running).map(task => task.conversationId)), finished = [...state.runningIds].some(id => !next.has(id)); state.runningIds = next; for (const id of state.pending.keys()) if (!next.has(id)) state.pending.delete(id); return finished; },
    setApproval(id: string, pending: boolean, details: Approval = {}) { if (!id) return; if (pending && isHumanProjectPendingApproval(details)) state.pending.set(id, details); else state.pending.delete(id); },
    setPinned(id: string, pinned: boolean) { const item = state.conversations.find(item => item.id === id); if (!item) return false; item.pinned = pinned; return true; },
    remove(id: string) { const length = state.conversations.length; state.conversations = state.conversations.filter(item => item.id !== id); state.runningIds.delete(id); state.pending.delete(id); state.completed.delete(id); return length !== state.conversations.length; },
  };
}
export type ProjectFoldersService = ReturnType<typeof createProjectFoldersService>;
