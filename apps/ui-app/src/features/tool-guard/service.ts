import { createEvents } from '../../platform/events';
import {
  MAX_RULES, RuleValidationError, configSchema, isDirty, newRuleId, normalizeConfig, parseToolArguments, testResultSchema,
  validateRules, type GuardConfig, type GuardRule, type GuardTestResult,
} from './model';

export interface GuardTransport {
  raw(path: string, init?: RequestInit, options?: { auth?: boolean }): Promise<Response>;
}

export interface GuardServiceDependencies {
  transport: GuardTransport;
  /** Translate `toolGuard.<key>` with `{{name}}` parameters filled. */
  t(key: string, params?: Record<string, string | number>): string;
  randomUUID?: () => string;
  now?: () => number;
  random?: () => number;
}

export interface AddDraft {
  rule: GuardRule;
  adding: boolean;
  revision: number;
}

export type GuardEvents = {
  changed: void;
  /** A local or global test finished; `scope` tells the view where the result belongs. */
  'test-result': { scope: 'global' | 'rule' | 'draft'; ruleId?: string; result: GuardTestResult; enabled: boolean };
};

/** Error text the view shows; `ruleIndex`/`field` let it reveal the offending editor. */
export class GuardError extends Error {
  constructor(message: string, readonly ruleIndex?: number, readonly ruleId?: string, readonly field?: 'name' | 'pattern' | 'message') {
    super(message);
    this.name = 'GuardError';
  }
}

export function createToolGuardService(dependencies: GuardServiceDependencies) {
  const { transport, t } = dependencies;
  const events = createEvents<GuardEvents>();
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;

  const state = {
    config: null as GuardConfig | null,
    saved: null as GuardConfig | null,
    etag: null as string | null,
    busy: false,
    testing: false,
    revision: 0,
    openRuleId: null as string | null,
    addDraft: null as AddDraft | null,
  };

  const changed = () => events.emit('changed', undefined);

  async function request<T>(path: string, method: string, body?: unknown, versioned = false): Promise<{ value: T; etag: string | null }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (versioned && method === 'PUT' && state.etag) headers['If-Match'] = state.etag;
    const response = await transport.raw(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof result.code === 'string' ? result.code : '';
      if (code === 'tool_guard_conflict') throw new GuardError(t('saveConflict'));
      if (code === 'tool_guard_version_required') throw new GuardError(t('versionRequired'));
      throw new GuardError(typeof result.error === 'string' ? result.error : t('requestFailed'));
    }
    return { value: result as T, etag: response.headers.get('ETag') };
  }

  function requestRules(config: GuardConfig): void {
    if (config.rules.length > MAX_RULES) throw new GuardError(t('tooManyRules'));
  }

  function requestBody(selected: GuardRule | null = null): GuardConfig {
    if (!state.config) throw new GuardError(t('loadFirst'));
    const config: GuardConfig = selected
      ? { enabled: true, rules: [{ ...selected, enabled: true }] }
      : structuredClone(state.config);
    validateRules(config.rules, { requiredFields: t('requiredFields'), fieldTooLong: t('fieldTooLong') });
    return config;
  }

  function asGuardError(error: unknown): GuardError {
    if (error instanceof GuardError) return error;
    if (error instanceof RuleValidationError) return new GuardError(error.message, error.ruleIndex, error.ruleId, error.field);
    return new GuardError(error instanceof Error ? error.message : String(error));
  }

  async function runTest(config: GuardConfig, toolName: string, args: Record<string, unknown>) {
    const response = await request<unknown>('/api/tool-guard/test', 'POST', { config, toolName, arguments: args });
    const parsed = testResultSchema.safeParse(response.value);
    if (!parsed.success) throw new GuardError(t('invalidTestResponse'));
    return parsed.data;
  }

  return {
    state,
    subscribe(listener: () => void): () => void {
      return events.on('changed', listener);
    },
    onTestResult(listener: (detail: GuardEvents['test-result']) => void): () => void {
      return events.on('test-result', listener);
    },
    isDirty: () => isDirty(state.config, state.saved),

    /** Loads the server config unless the user has unsaved edits (those are kept). */
    async load(): Promise<void> {
      if (state.busy || isDirty(state.config, state.saved) || state.addDraft) { changed(); return; }
      state.busy = true;
      changed();
      try {
        const response = await request<unknown>('/api/tool-guard', 'GET', undefined, true);
        const parsed = configSchema.safeParse(response.value);
        if (!parsed.success) throw new GuardError(t('invalidResponse'));
        const config = normalizeConfig(parsed.data);
        state.etag = response.etag;
        state.saved = structuredClone(config);
        state.config = config;
        state.revision += 1;
      } catch (error) {
        throw new GuardError(`${t('loadFailed')}: ${asGuardError(error).message}`);
      } finally {
        state.busy = false;
        changed();
      }
    },

    async save(): Promise<void> {
      if (state.busy || !isDirty(state.config, state.saved)) return;
      state.busy = true;
      changed();
      try {
        const config = requestBody();
        const response = await request<unknown>('/api/tool-guard', 'PUT', config, true);
        const parsed = configSchema.safeParse(response.value);
        if (!parsed.success) throw new GuardError(t('invalidResponse'));
        const saved = normalizeConfig(parsed.data);
        state.etag = response.etag;
        state.saved = structuredClone(saved);
        state.config = saved;
        state.revision += 1;
      } catch (error) {
        const failure = asGuardError(error);
        throw new GuardError(`${t('saveFailed')}: ${failure.message}`, failure.ruleIndex, failure.ruleId, failure.field);
      } finally {
        state.busy = false;
        changed();
      }
    },

    reset(): void {
      if (state.busy || !state.saved) return;
      state.addDraft = null;
      state.config = structuredClone(state.saved);
      state.revision += 1;
      changed();
    },

    setEnabled(enabled: boolean): void {
      if (!state.config || state.busy) return;
      state.config.enabled = enabled;
      state.revision += 1;
      changed();
    },

    /** Any edit makes older test results stale. */
    invalidateTest(): void {
      state.revision += 1;
      changed();
    },

    setOpenRule(id: string | null): void {
      state.openRuleId = id;
      changed();
    },

    deleteRule(id: string): void {
      if (!state.config || state.busy) return;
      state.config.rules = state.config.rules.filter(rule => rule.id !== id);
      if (state.openRuleId === id) state.openRuleId = null;
      state.revision += 1;
      changed();
    },

    startAdd(defaultMessage: string): AddDraft {
      if (!state.config || state.busy) throw new GuardError(t('loadFirst'));
      if (state.config.rules.length >= MAX_RULES) throw new GuardError(t('tooManyRules'));
      if (state.addDraft) return state.addDraft;
      const id = newRuleId(dependencies.randomUUID, now(), random());
      state.addDraft = { rule: { id, name: '', enabled: true, pattern: '', message: defaultMessage }, adding: false, revision: 0 };
      changed();
      return state.addDraft;
    },

    cancelAdd(): void {
      state.addDraft = null;
      changed();
    },

    touchDraft(): void {
      if (state.addDraft) state.addDraft.revision += 1;
    },

    /** Validates the draft with the backend engine, then appends it to the list. */
    async commitAdd(draft: AddDraft): Promise<void> {
      if (!state.config || state.addDraft !== draft || draft.adding) return;
      const revision = draft.revision;
      draft.adding = true;
      changed();
      try {
        if (state.config.rules.length >= MAX_RULES) throw new GuardError(t('tooManyRules'));
        const config = requestBody(draft.rule);
        requestRules(config);
        await runTest(config, 'rule_validation', {});
        if (state.addDraft !== draft || revision !== draft.revision) return;
        state.config.rules.push(structuredClone(draft.rule));
        state.addDraft = null;
        state.openRuleId = null;
        state.revision += 1;
        changed();
      } catch (error) {
        if (state.addDraft !== draft || revision !== draft.revision) return;
        throw asGuardError(error);
      } finally {
        draft.adding = false;
        changed();
      }
    },

    /** Global test: the whole config against a tool call, from the test panel. */
    async testAll(toolName: string, argumentsText: string): Promise<void> {
      if (state.busy || state.testing || !state.config) return;
      const revision = state.revision;
      state.testing = true;
      changed();
      try {
        const config = requestBody();
        const trimmed = toolName.trim();
        if (!trimmed) throw new GuardError(t('toolRequired'));
        const args = parseArgumentsOrThrow(argumentsText, t);
        const result = await runTest(config, trimmed, args);
        if (state.revision !== revision) return;
        events.emit('test-result', { scope: 'global', result, enabled: config.enabled });
      } catch (error) {
        throw asGuardError(error);
      } finally {
        state.testing = false;
        changed();
      }
    },

    /** Single-rule test: only this rule is active, the rest of the config is ignored. */
    async testRule(rule: GuardRule, toolName: string, argumentsText: string, scope: 'rule' | 'draft'): Promise<void> {
      if (state.busy || !state.config) return;
      const config = requestBody(rule);
      const trimmed = toolName.trim();
      if (!trimmed) throw new GuardError(t('toolRequired'));
      const args = parseArgumentsOrThrow(argumentsText, t);
      const result = await runTest(config, trimmed, args);
      events.emit('test-result', { scope, ruleId: rule.id, result, enabled: true });
    },
  };
}

function parseArgumentsOrThrow(text: string, t: (key: string) => string) {
  try {
    return parseToolArguments(text);
  } catch {
    throw new GuardError(t('invalidArguments'));
  }
}

export type ToolGuardService = ReturnType<typeof createToolGuardService>;
