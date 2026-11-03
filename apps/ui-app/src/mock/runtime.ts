import * as common from './common';
import { MockRouter, ok, json, fail, blob, sse } from './router';
import { seed, PERMISSION_CATALOG } from './seed';
import { seedSchema, SEED_VERSION, type Config, type Conversation, type Message, type Project, type Seed, type User } from './types';
import type { z } from 'zod';
import type { hitlConfigSchema } from './types';
import { toStoredSession, type LoginResponse } from '../api/types/auth';

export interface MockStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export const STORE_KEY = 'csai-mock-state-v1';
export const AUTH_KEY = 'raptix-auth';
export interface SessionPayload extends Pick<LoginResponse, 'token' | 'expires_at' | 'session_duration_hr' | 'user' | 'permissions' | 'scope'> {
  roles: string[]; permission_scopes: Record<string, string>;
}

export class MockRuntime extends MockRouter {
  state: Seed;
  private idSeq = 0;
  readonly PERMISSION_CATALOG = PERMISSION_CATALOG;
  readonly ok = ok; readonly json = json; readonly fail = fail; readonly blob = blob; readonly sse = sse;
  readonly q = common.q; readonly qInt = common.qInt; readonly matchSearch = common.matchSearch; readonly filterList = common.filterList;
  readonly limitOffset = common.limitOffset; readonly pagePaged = common.pagePaged; readonly findById = common.findById; readonly mergeInto = common.mergeInto;
  readonly removeAt = <T>(list: T[], index: number): void => { list.splice(index, 1); };
  readonly clone = <T>(value: T): T => structuredClone(value);
  readonly sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
  readonly nowISO = (): string => new Date().toISOString();
  readonly isoAgo = (minutes: number): string => new Date(Date.now() - minutes * 60000).toISOString();
  // Registered once during composition, before interception is installed.
  sessionPayload!: (user: User) => SessionPayload;
  convView!: (conversation: Conversation, messages: boolean) => Conversation & { messages?: Message[] };
  projectView!: (project: Project) => Project & { conversation_count: number; vulnerability_count: number; asset_count: number };
  hitlDefaults!: () => z.infer<typeof hitlConfigSchema>;
  configSeed!: () => Config;
  recountKnowledge!: () => void;

  constructor(private readonly storage?: MockStorage, forceReset = false, delayMs?: number) {
    super(delayMs);
    try { this.debug = storage?.getItem('csai-mock-debug') === '1'; } catch { /* blocked storage */ }
    if (forceReset) { this.remove(STORE_KEY); this.remove(AUTH_KEY); }
    this.state = seed();
    if (!forceReset) {
      try { const raw = storage?.getItem(STORE_KEY); if (raw) { const parsed = seedSchema.safeParse(JSON.parse(raw)); if (parsed.success) this.state = parsed.data; } } catch { /* blocked or corrupt storage */ }
    }
    this.save();
  }
  id(prefix = 'id'): string { return prefix + '-' + Date.now().toString(36) + '-' + (++this.idSeq).toString(36); }
  save(): void { try { this.state.__version = SEED_VERSION; this.storage?.setItem(STORE_KEY, JSON.stringify(this.state)); } catch { /* quota or blocked storage */ } }
  reset(): void { this.remove(STORE_KEY); this.state = seed(); this.save(); }
  private remove(key: string): void { try { this.storage?.removeItem(key); } catch { /* blocked storage */ } }
  seedSession(): void {
    try {
      const raw = this.storage?.getItem(AUTH_KEY);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        if (typeof stored === 'object' && stored !== null && 'token' in stored && stored.token && 'expiresAt' in stored && typeof stored.expiresAt === 'string' && new Date(stored.expiresAt).getTime() > Date.now()) return;
      }
      const user = this.state.users.find(user => user.id === 'user-admin');
      if (!user) return;
      if (!this.state.sessionUserId) this.state.sessionUserId = user.id;
      const payload = this.sessionPayload(user);
      this.storage?.setItem(AUTH_KEY, JSON.stringify(toStoredSession({ ...payload })));
      this.save();
    } catch (error) { console.warn('[csai-mock] could not seed session', error); }
  }
}
