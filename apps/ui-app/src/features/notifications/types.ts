import type { KeyValueStorage } from '../../platform/storage';
import type { NotificationRuntime } from '../../platform/notification-browser';

export type Request = (url: string, options?: RequestInit) => Promise<Response>;
export type Translate = (key: string, options?: Record<string, unknown>) => string;
// internal/handler/notification.go NotificationSummaryItem/Response.
export interface NotificationItem {
  id: string; level?: string; type?: string; title?: string; desc?: string; ts?: string;
  count?: number; actionable?: boolean; read?: boolean; conversationId?: string;
  vulnerabilityId?: string; executionId?: string; interruptId?: string; sessionId?: string;
}
export interface NotificationSummary {
  items?: NotificationItem[] | null; unreadCount?: number | string; sinceMs?: number;
  generatedAt?: string; p0Count?: number; counts?: Record<string, number>;
}
export interface NotificationModel { items: NotificationItem[]; unreadCount: number; open: boolean; lastSeenAt: number }
export interface NotificationDependencies {
  request: Request; translate: Translate; locale(): string; storage: KeyValueStorage;
  runtime: NotificationRuntime; navigate(item: NotificationItem): void; canMarkAll(): boolean;
}
