// Loading the attack chain of a conversation: one request owns the view at a time, a request for another conversation or
// a newer request makes an answer stale, and a chain that is still being generated is retried a few seconds later.

export const CHAIN_RETRY_DELAY_MS = 5000;

export interface ChainFlowDependencies {
  t(key: string, fallback: string, values?: Record<string, unknown>): string;
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Resets the view of the previous chain (its graph and its context panel). */
  resetContext(): void;
  /** Shows the loading state in the chain container. */
  showLoading(): void;
  /** Shows a failure in the chain container. */
  showError(message: string): void;
  renderChain(data: unknown): void;
  updateStats(data: unknown): void;
  /** The regenerate button of the dialog, which is disabled while a chain loads. */
  setRegenerateEnabled(enabled: boolean): void;
  /** Shows the "being generated" state, with its refresh button. */
  showGenerating(): void;
  /** Shows the "regenerating" state in the chain container. */
  showRegenerating(): void;
  /** Shows that the chain is already being generated when a regenerate is asked for, with its refresh button. */
  showConflict(): void;
  refresh(): void;
  setTimer(callback: () => void, ms: number): unknown;
  logInfo(message: string, details: unknown): void;
  logError(message: string, error: unknown): void;
}

export interface ChainFlow {
  current(): string | null;
  setCurrent(conversationId: string | null): void;
  isLoading(conversationId: string): boolean;
  setLoading(conversationId: string, value: boolean): void;
  /** Drops the pending request of a conversation, as closing its dialog does. */
  invalidate(conversationId: string): void;
  /** Starts a fresh view for a conversation; an older request for it is discarded. */
  begin(conversationId: string): void;
  load(conversationId: string): Promise<void>;
  /** Builds the chain again from the latest conversation, and shows it when it is ready. */
  regenerate(conversationId: string): Promise<void>;
  /** Whether a request is still the one that owns the view. */
  isCurrent(conversationId: string, sequence: number): boolean;
  sequence(): number;
}

export function createChainFlow(deps: ChainFlowDependencies): ChainFlow {
  let current: string | null = null;
  let sequence = 0;
  const owners = new Map<string, number>();
  const loading = new Map<string, boolean>();

  const isLoading = (conversationId: string) => loading.get(conversationId) === true;

  function setLoading(conversationId: string, value: boolean): void {
    if (value) loading.set(conversationId, true);
    else loading.delete(conversationId);
  }

  function beginRequest(conversationId: string): number {
    const next = ++sequence;
    owners.set(conversationId, next);
    return next;
  }

  function isCurrent(conversationId: string, requestSequence: number): boolean {
    return current === conversationId && sequence === requestSequence;
  }

  function finish(conversationId: string, requestSequence: number): void {
    if (owners.get(conversationId) === requestSequence) {
      owners.delete(conversationId);
      setLoading(conversationId, false);
    }
  }

  function begin(conversationId: string): void {
    current = conversationId;
    // Reopening or returning to a conversation starts a fresh view, even if an old request is still pending.
    sequence += 1;
    owners.delete(conversationId);
    setLoading(conversationId, false);
    deps.resetContext();
  }

  async function load(conversationId: string): Promise<void> {
    if (isLoading(conversationId)) return;
    setLoading(conversationId, true);
    const requestSequence = beginRequest(conversationId);
    if (current === conversationId) {
      deps.resetContext();
      deps.showLoading();
    }

    try {
      const response = await deps.request(`/api/attack-chain/${conversationId}`);
      if (!isCurrent(conversationId, requestSequence)) {
        finish(conversationId, requestSequence);
        return;
      }

      if (!response.ok) {
        if (response.status === 409) {
          // Still being generated: show that, retry shortly, and keep the loading state so a second click does not start another.
          deps.showGenerating();
          deps.setTimer(() => {
            if (isCurrent(conversationId, requestSequence)) deps.refresh();
          }, CHAIN_RETRY_DELAY_MS);
          deps.setRegenerateEnabled(true);
          return;
        }
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Failed to load the attack chain');
      }

      const chain = await response.json();
      if (!isCurrent(conversationId, requestSequence)) {
        deps.logInfo('Attack chain data returned but the displayed conversation changed; ignoring this render', { returned: conversationId, current });
        finish(conversationId, requestSequence);
        return;
      }
      deps.renderChain(chain);
      deps.updateStats(chain);
      finish(conversationId, requestSequence);
    } catch (error) {
      deps.logError('Failed to load attack chain:', error);
      finish(conversationId, requestSequence);
      if (!isCurrent(conversationId, requestSequence)) return;
      deps.resetContext();
      const message = error instanceof Error ? error.message : String(error);
      deps.showError(deps.t('chat.loadFailed', `Load failed: ${message}`, { message }));
    } finally {
      if (isCurrent(conversationId, requestSequence)) deps.setRegenerateEnabled(true);
    }
  }

  async function regenerate(conversationId: string): Promise<void> {
    if (isLoading(conversationId)) return;
    setLoading(conversationId, true);
    const requestSequence = beginRequest(conversationId);
    deps.resetContext();
    deps.showRegenerating();
    deps.setRegenerateEnabled(false);

    try {
      const response = await deps.request(`/api/attack-chain/${conversationId}/regenerate`, { method: 'POST' });
      if (!isCurrent(conversationId, requestSequence)) return;

      if (!response.ok) {
        if (response.status === 409) {
          // Already being generated: say so, and look again shortly, as a load does.
          deps.showConflict();
          deps.setTimer(() => {
            if (isCurrent(conversationId, requestSequence)) deps.refresh();
          }, CHAIN_RETRY_DELAY_MS);
          return;
        }
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Failed to regenerate the attack chain');
      }

      const chain = await response.json();
      if (!isCurrent(conversationId, requestSequence)) {
        deps.logInfo('Attack chain data returned but the displayed conversation changed; ignoring this render', { returned: conversationId, current });
        return;
      }
      deps.renderChain(chain);
      deps.updateStats(chain);
    } catch (error) {
      deps.logError('Failed to regenerate attack chain:', error);
      if (!isCurrent(conversationId, requestSequence)) return;
      deps.resetContext();
      const message = error instanceof Error ? error.message : String(error);
      deps.showError(deps.t('attackChainModal.regenerateFailed', `Regeneration failed: ${message}`, { message }));
    } finally {
      finish(conversationId, requestSequence);
      if (isCurrent(conversationId, requestSequence)) deps.setRegenerateEnabled(true);
    }
  }

  return {
    current: () => current,
    setCurrent: id => { current = id; },
    isLoading,
    setLoading,
    invalidate(conversationId: string) {
      sequence += 1;
      owners.delete(conversationId);
      setLoading(conversationId, false);
    },
    begin,
    load,
    regenerate,
    isCurrent,
    sequence: () => sequence,
  };
}
