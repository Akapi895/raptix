import { createEvents } from '../../platform/events';
import {
  REVEAL_TIMEOUT_MS, VaultValidationError, secretsResponseSchema, normalizeSecret, validateAddFields,
  type VaultSecret,
} from './model';

export interface VaultTransport {
  get<T>(path: string, options?: { query?: Record<string, string | number | boolean | undefined> }): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export interface VaultServiceDependencies {
  transport: VaultTransport;
  t(key: string, params?: Record<string, string | number>): string;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface RevealedEntry {
  value: string;
  timer: ReturnType<typeof setTimeout>;
}

export type VaultEvents = { changed: void };

export class VaultError extends Error {
  constructor(message: string, readonly field?: 'name' | 'value') {
    super(message);
    this.name = 'VaultError';
  }
}

export function createVaultService(dependencies: VaultServiceDependencies) {
  const { transport, t } = dependencies;
  const schedule = dependencies.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = dependencies.clearTimeout ?? ((handle) => clearTimeout(handle));
  const events = createEvents<VaultEvents>();

  const state = {
    projectId: null as string | null,
    projects: [] as { id: string; name: string }[],
    secrets: [] as VaultSecret[],
    globalSecrets: [] as VaultSecret[],
    busy: false,
    loaded: false,
    revealed: new Map<string, RevealedEntry>(),
  };

  const changed = () => events.emit('changed', undefined);

  function asVaultError(error: unknown): VaultError {
    if (error instanceof VaultError) return error;
    if (error instanceof VaultValidationError) return new VaultError(t(error.message), error.field);
    return new VaultError(error instanceof Error ? error.message : String(error));
  }

  function clearRevealed(id: string): void {
    const entry = state.revealed.get(id);
    if (!entry) return;
    cancel(entry.timer);
    state.revealed.delete(id);
  }

  function clearAllRevealed(): void {
    for (const id of [...state.revealed.keys()]) clearRevealed(id);
  }

  /** No busy-guard: callers that already hold `state.busy` (add/revoke/promote) call this directly. */
  async function fetchSecrets(): Promise<void> {
    if (!state.projectId) return;
    const [projectSecrets, globalSecrets] = await Promise.all([
      transport.get<unknown>(`/api/projects/${encodeURIComponent(state.projectId)}/vault/secrets`),
      transport.get<unknown>('/api/vault/global-secrets'),
    ]);
    const parsedProject = secretsResponseSchema.safeParse(projectSecrets);
    const parsedGlobal = secretsResponseSchema.safeParse(globalSecrets);
    if (!parsedProject.success || !parsedGlobal.success) throw new VaultError(t('invalidResponse'));
    state.secrets = parsedProject.data.secrets.map(normalizeSecret);
    state.globalSecrets = parsedGlobal.data.secrets.map(normalizeSecret);
    state.loaded = true;
  }

  return {
    state,
    subscribe(listener: () => void): () => void {
      return events.on('changed', listener);
    },
    revealedValue(id: string): string | null {
      return state.revealed.get(id)?.value ?? null;
    },

    async loadProjects(): Promise<void> {
      const response = await transport.get<{ projects: { id: string; name: string }[] }>('/api/projects', { query: { limit: 200 } });
      state.projects = response.projects;
      if (!state.projectId && state.projects[0]) state.projectId = state.projects[0].id;
      changed();
    },

    selectProject(projectId: string): void {
      if (state.projectId === projectId) return;
      clearAllRevealed();
      state.projectId = projectId;
      state.secrets = [];
      state.loaded = false;
      changed();
    },

    async load(): Promise<void> {
      if (state.busy || !state.projectId) return;
      state.busy = true;
      changed();
      try {
        await fetchSecrets();
      } catch (error) {
        throw new VaultError(`${t('loadFailed')}: ${asVaultError(error).message}`);
      } finally {
        state.busy = false;
        changed();
      }
    },

    async add(name: string, value: string, description: string): Promise<void> {
      if (!state.projectId || state.busy) return;
      try {
        validateAddFields(name, value);
      } catch (error) {
        throw asVaultError(error);
      }
      state.busy = true;
      changed();
      try {
        await transport.post(`/api/projects/${encodeURIComponent(state.projectId)}/vault/secrets`, { name, plaintext: value, description });
        await fetchSecrets();
      } catch (error) {
        throw new VaultError(`${t('addFailed')}: ${asVaultError(error).message}`);
      } finally {
        state.busy = false;
        changed();
      }
    },

    /** Reveal is explicit and audited server-side; the plaintext is held only in this map, cleared on timeout/hide/dispose. */
    async reveal(secret: VaultSecret): Promise<void> {
      if (!state.projectId || state.revealed.has(secret.id)) return;
      try {
        const result = await transport.post<{ plaintext: string }>(
          `/api/projects/${encodeURIComponent(state.projectId)}/vault/secrets/${encodeURIComponent(secret.id)}/reveal`,
        );
        const timer = schedule(() => { clearRevealed(secret.id); changed(); }, REVEAL_TIMEOUT_MS);
        state.revealed.set(secret.id, { value: result.plaintext, timer });
        changed();
      } catch (error) {
        throw new VaultError(`${t('revealFailed')}: ${asVaultError(error).message}`);
      }
    },

    hide(id: string): void {
      clearRevealed(id);
      changed();
    },

    async revoke(secret: VaultSecret): Promise<void> {
      if (!state.projectId || state.busy) return;
      state.busy = true;
      changed();
      try {
        clearRevealed(secret.id);
        await transport.delete(`/api/projects/${encodeURIComponent(state.projectId)}/vault/secrets/${encodeURIComponent(secret.id)}`);
        await fetchSecrets();
      } catch (error) {
        throw new VaultError(`${t('revokeFailed')}: ${asVaultError(error).message}`);
      } finally {
        state.busy = false;
        changed();
      }
    },

    async promote(secret: VaultSecret): Promise<void> {
      if (!state.projectId || state.busy) return;
      state.busy = true;
      changed();
      try {
        await transport.post(`/api/projects/${encodeURIComponent(state.projectId)}/vault/secrets/${encodeURIComponent(secret.id)}/promote`);
        await fetchSecrets();
      } catch (error) {
        throw new VaultError(`${t('promoteFailed')}: ${asVaultError(error).message}`);
      } finally {
        state.busy = false;
        changed();
      }
    },

    dispose(): void {
      clearAllRevealed();
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
