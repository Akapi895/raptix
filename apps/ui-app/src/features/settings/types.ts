import type { ApiFetch, Translate } from './contracts';
import type { AIConfig } from './model';
import type { SelectEnvironment } from './selects';
export interface SettingsDependencies {
  doc: Document; request: ApiFetch; t: Translate;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  browser: SelectEnvironment & { settingsHash(section: string): void; c2Enabled(enabled: boolean): void };
  can(permission: string): boolean; alert(message: string): void; confirm(message: string): boolean;
  navigate(page: string): void; navigateSection(section: string): void; notifyError(message: string): void;
  section(name: 'token-usage' | 'robots' | 'terminal' | 'audit' | 'storage'): void;
  stopTokenUsage(): void; syncDashboardAccessTabs(): void;
  refreshChatConfig(): Promise<unknown>; populateChatChannels(ai: AIConfig): void; refreshMentionTools(): void;
  unauthorized(message: string): void; closeMCPDetail(): void;
}
