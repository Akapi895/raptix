// DTOs follow internal/database/audit.go and internal/handler/audit.go.
export interface AuditLog {
  id: string; createdAt: string; level: string; category: string; action: string;
  result: string; actor: string; message: string; sessionHint?: string; clientIp?: string;
  userAgent?: string; resourceType?: string; resourceId?: string; resourceAvailable?: boolean;
  detail?: Record<string, unknown>;
}
export interface AuditSummary { total: number; failures?: number; recent_7d?: number; has_filters?: boolean }
export interface AuditPage { logs: AuditLog[] | null; total: number; page: number; page_size?: number; pageSize?: number }
export interface AuditFilters { category: string; action: string; result: string; q: string; since: string; until: string }
export type AuditPreset = '15m' | '1h' | '24h' | '7d' | 'today';
export interface AuditDependencies {
  translate(key: string, options?: Record<string, string | number>): string;
  getLocale(): string;
  applyTranslations(root: HTMLElement): void;
  toast(message: string, kind: 'success' | 'error' | 'warning'): void;
  requirePermission(permission: string): boolean;
  navigate(page: string): void;
  settingsSection(section: string): void;
  loadConversation(id: string): void | Promise<void>;
  openModal(element: HTMLElement): void;
  closeModal(id: string): void;
  syncModalBodyLock(): void;
  deferModalContent(callback: () => void): void;
  initPaginationSelects(root: HTMLElement): void;
  download(blob: Blob, filename: string): void;
  viewport(): { width: number; height: number };
}
