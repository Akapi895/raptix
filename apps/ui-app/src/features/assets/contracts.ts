import type { KeyValueStorage } from '../../platform/storage';

export type Request = (path: string, init?: RequestInit) => Promise<Response>;
export type Translate = (key: string, options?: Record<string, string | number>) => string;
export interface ToastOptions { duration?: number; id?: string; replace?: boolean }
export interface ToastHandle { remove(): void }
/** Lazy ports: chat, settings and task management are still classic scripts. */
export interface AssetsDependencies {
  request: Request;
  storage: KeyValueStorage;
  t: Translate;
  locale(): string;
  can(permission: string): boolean;
  alert(message: string): void;
  confirm(message: string): boolean;
  prompt(message: string): string | null;
  applyPermissions(root: HTMLElement): void;
  enhanceSelect(select: HTMLSelectElement): void;
  syncSelect(select: HTMLSelectElement): void;
  closeSelects(): void;
  refreshSelects(): void;
  paginationSelects(root: HTMLElement): void;
  hash(): string;
  setHash(hash: string): void;
  replaceHash(hash: string): void;
  onResize(listener: () => void): () => void;
  copy(text: string): Promise<void>;
  switchPage(page: string): void;
  loadConversation(id: string): Promise<void>;
  navigateConversation(id: string): Promise<void>;
  currentConversation(): string;
  startConversation(): Promise<void>;
  sendMessage(options?: { onRequestAccepted(): void }): Promise<unknown>;
  requireExecutionEvidence(): void;
  refreshConversations(): void;
  showQueue(id: string): void;
  currentRole(): string;
  activeProject(): string;
  onProjectChange?(listener: () => void): () => void;
  setActiveProject?(id: string): void;
  projectName?(id: string): string;
  refreshProjectAssets(): Promise<void>;
  openProjectFact(projectId: string, factKey: string): Promise<void>;
  robotEnabled(type: string): boolean;
  notify(text: string, type: 'success' | 'error'): void;
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function download(doc: Document, content: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = doc.createElement('a'); link.href = url; link.download = name;
  doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** All response decoding lives at the service boundary, including non-JSON Go errors. */
export async function requestJSON<T>(request: Request, path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init);
  const text = await response.text();
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { value = text; }
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : text;
    throw new Error(message || `HTTP ${response.status}`);
  }
  return value as T;
}
export function jsonBody(method: string, value: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}
