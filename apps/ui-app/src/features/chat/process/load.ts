// Loading the process details of a message: the pages are fetched and rendered one by one, a lazy load starts when the details
// are first opened, and the toggle opens or closes them. The fetches, the renderer and the scroll follow come in through `deps`.

export interface LoadOptions {
  signal?: AbortSignal;
  autoLoadAll?: boolean;
  prepend?: boolean;
  append?: boolean;
  anchorId?: unknown;
  initialLatest?: boolean;
  initialStart?: boolean;
}

export interface LoadDeps {
  doc: Document;
  /** A translation with the fallback when the page has none. */
  tr(key: string, fallback: string): string;
  request(path: string, init?: RequestInit): Promise<Response>;
  pageSize: number;
  restoreFollowMs: number;
  hasRenderer(): boolean;
  renderProcessDetails(assistantMessageId: string, details: unknown[] | null, options?: Record<string, unknown>): void;
  updatePagination(assistantMessageId: string, backendMessageId: string, state: { hasPrev: boolean; hasNext: boolean }): void;
  startFollow(assistantMessageId: string, options: { durationMs: number }): void;
  scrollToLatest(assistantMessageId: string, smooth: boolean): void;
  nextFrame(): Promise<void>;
  scheduleFrame(callback: () => void): void;
  bindLazyHint(timeline: HTMLElement, assistantMessageId: string): void;
  syncButtonLabels(assistantMessageId: string, expanded: boolean): void;
  updateReturnControl(timeline: HTMLElement): void;
  syncTurnSummary(assistantElement: HTMLElement | null): void;
  capturePinned(): boolean;
  scrollIntoViewIfFollowing(element: HTMLElement, options: ScrollIntoViewOptions): boolean;
  /** The replay of a running task's events, when it shows this message. */
  replayAssistantDomId(): string | null;
  setTimeout(callback: () => void, ms: number): void;
  openUserInterrupt(progressId: string, conversationId: string): void;
  progressState(progressId: string): { conversationId?: string | null; cancelling?: boolean } | undefined;
  stopButtonFor(progressId: string): HTMLButtonElement | null;
  alert(message: string): void;
  logError(message: string, error: unknown): void;
}

/** The backend message id an event carries, trimmed, or an empty text when it carries none. */
export function resolveEventBackendMessageId(eventData: unknown): string {
  if (!eventData || typeof eventData !== 'object') return '';
  const record = eventData as { messageId?: unknown; assistantMessageId?: unknown };
  const raw = record.messageId != null ? record.messageId : record.assistantMessageId;
  return raw != null ? String(raw).trim() : '';
}

/** The details of a message open at the newest round when the message is still streaming, else from the first round. */
export function shouldInitiallyOpenProcessDetailsAtLatest(deps: LoadDeps, assistantMessageId: string, detailsContainer: HTMLElement | null): boolean {
  if (!detailsContainer) return false;
  if (detailsContainer.classList.contains('is-streaming')) return true;
  const replay = deps.replayAssistantDomId();
  if (replay !== null && replay === String(assistantMessageId || '')) return true;
  return false;
}

/** Loads the pages of a message's process details, and renders each one as it arrives. */
export async function loadProcessDetailsPaginated(deps: LoadDeps, assistantMessageId: string, backendMessageId: string, options: LoadOptions = {}): Promise<void> {
  if (!assistantMessageId || !backendMessageId || !deps.hasRenderer()) return;
  const opts = options || {};
  const signal = opts.signal;
  if (signal && signal.aborted) return;
  const autoLoadAll = opts.autoLoadAll !== false;
  const detailsContainer = deps.doc.getElementById('process-details-' + assistantMessageId);
  const PAGE = deps.pageSize;
  const existingNextOffset = detailsContainer && detailsContainer.dataset.nextOffset
    ? parseInt(detailsContainer.dataset.nextOffset, 10) || 0
    : 0;
  const prepend = !!opts.prepend;
  let offset = prepend && detailsContainer && detailsContainer.dataset.prevOffset
    ? parseInt(detailsContainer.dataset.prevOffset, 10) || 0
    : opts.append && detailsContainer && detailsContainer.dataset.nextOffset
      ? parseInt(detailsContainer.dataset.nextOffset, 10) || 0
      : 0;
  const anchorId = opts.anchorId != null ? String(opts.anchorId).trim() : '';
  if (opts.initialLatest && !prepend && !opts.append && !anchorId) {
    // Until the first page is drawn, the top sentinel must not fire; it opens again once the reader is at the bottom.
    if (detailsContainer) detailsContainer.dataset.autoLoadSuspended = '1';
    const summaryRes = await deps.request(
      '/api/messages/' + encodeURIComponent(String(backendMessageId)) + '/process-details?summary=1',
      signal ? { signal } : undefined,
    );
    const summaryJSON = await summaryRes.json().catch(() => ({})) as { error?: string; summary?: { total?: unknown } };
    if (!summaryRes.ok) throw new Error(summaryJSON && summaryJSON.error ? summaryJSON.error : String(summaryRes.status));
    const total = summaryJSON && summaryJSON.summary && Number(summaryJSON.summary.total);
    offset = Number.isFinite(total) ? Math.max(0, (total as number) - PAGE) : 0;
  }
  let isFirst = !opts.append;
  while (true) {
    if (signal && signal.aborted) return;
    const params = new URLSearchParams();
    params.set('limit', String(PAGE));
    if (anchorId && !opts.append && !prepend) params.set('anchorId', anchorId);
    else params.set('offset', String(offset));
    const res = await deps.request(
      '/api/messages/' + encodeURIComponent(String(backendMessageId)) + '/process-details?' + params.toString(),
      signal ? { signal } : undefined,
    );
    const j = await res.json().catch(() => ({})) as {
      error?: string; processDetails?: unknown[]; toolExecutions?: unknown[]; hasMore?: boolean; offset?: number; total?: number;
    };
    if (!res.ok) throw new Error(j && j.error ? j.error : String(res.status));
    if (signal && signal.aborted) return;
    const details = j && Array.isArray(j.processDetails) ? j.processDetails : [];
    const toolExecutions = j && Array.isArray(j.toolExecutions) ? j.toolExecutions : [];
    const hasMore = !!(j && j.hasMore);
    deps.renderProcessDetails(assistantMessageId, details, {
      append: !isFirst || opts.append,
      prepend,
      markLoaded: autoLoadAll ? !hasMore : true,
      toolExecutions,
    });
    // The renderer draws a large page in frames; the sentinels are placed after the first frame so that a later batch does not
    // put them in the middle of the timeline.
    await deps.nextFrame();
    const responseOffset = j && typeof j.offset === 'number' ? j.offset : offset;
    const total = j && typeof j.total === 'number' ? j.total : responseOffset + details.length;
    const nextOffset = prepend && existingNextOffset > 0 ? existingNextOffset : responseOffset + details.length;
    const prevOffset = Math.max(0, responseOffset - PAGE);
    offset = nextOffset;
    if (detailsContainer) {
      detailsContainer.dataset.lazyNotLoaded = '0';
      detailsContainer.dataset.loaded = hasMore ? 'partial' : '1';
      detailsContainer.dataset.prevOffset = String(prevOffset);
      detailsContainer.dataset.nextOffset = String(nextOffset);
      detailsContainer.dataset.total = String(total);
    }
    deps.updatePagination(assistantMessageId, backendMessageId, {
      hasPrev: !autoLoadAll && responseOffset > 0,
      hasNext: !autoLoadAll && nextOffset < total,
    });
    if (!hasMore || details.length === 0 || !autoLoadAll) break;
    isFirst = false;
    await deps.nextFrame();
  }
  if (opts.initialLatest) {
    // The renderer may still append frames, and the restored stream keeps growing the same thinking text; the details follow their
    // own latest round for a while, not just the outer conversation.
    deps.startFollow(assistantMessageId, { durationMs: deps.restoreFollowMs });
    deps.scheduleFrame(() => {
      deps.scrollToLatest(assistantMessageId, false);
      if (detailsContainer) delete detailsContainer.dataset.autoLoadSuspended;
    });
  } else if (opts.initialStart) {
    deps.scheduleFrame(() => {
      const container = deps.doc.getElementById('process-details-' + assistantMessageId);
      const timeline = container && container.querySelector<HTMLElement>('.progress-timeline');
      if (timeline) timeline.scrollTop = 0;
    });
  }
}

/** Starts the lazy load of a message's details, unless one is already running. */
export function triggerLazyProcessDetailsLoad(deps: LoadDeps, assistantMessageId: string, backendMessageId: string, detailsContainer: HTMLElement): boolean {
  if (!assistantMessageId || !backendMessageId || !detailsContainer) return false;
  if (detailsContainer.dataset.loading === '1') return false;
  detailsContainer.dataset.loading = '1';
  const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
  if (timeline) timeline.innerHTML = '<div class="progress-timeline-empty">' + deps.tr('common.loading', 'Loading…') + '</div>';
  const openAtLatest = shouldInitiallyOpenProcessDetailsAtLatest(deps, assistantMessageId, detailsContainer);
  void loadProcessDetailsPaginated(deps, assistantMessageId, backendMessageId, {
    autoLoadAll: false,
    initialLatest: openAtLatest,
    initialStart: !openAtLatest,
  })
    .catch(e => {
      deps.logError('Failed to load process details:', e);
      const tl = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
      if (tl) {
        tl.innerHTML = '<div class="progress-timeline-empty">' + deps.tr('chat.noProcessDetail', 'No process details (execution may be too fast or no detailed events)') + '</div>';
        deps.bindLazyHint(tl, assistantMessageId);
      }
      detailsContainer.dataset.lazyNotLoaded = '1';
      detailsContainer.dataset.loaded = '0';
    })
    .finally(() => {
      detailsContainer.dataset.loading = '0';
      if (detailsContainer.dataset.userExpanded === '1') {
        const tl = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
        if (tl) tl.classList.add('expanded');
        deps.syncButtonLabels(assistantMessageId, true);
      }
    });
  return true;
}

/** When the message's backend id arrives after the details were asked for, the lazy load runs then, if the details are open. */
export function maybeReloadLazyProcessDetails(deps: LoadDeps, assistantMessageId: string, backendIdOf: (id: string) => string): void {
  const detailsContainer = deps.doc.getElementById('process-details-' + assistantMessageId) as HTMLElement | null;
  if (!detailsContainer) return;
  const isLazy = detailsContainer.dataset.lazyNotLoaded === '1' && detailsContainer.dataset.loaded !== '1';
  if (!isLazy) return;
  const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
  const wantsExpanded = detailsContainer.dataset.userExpanded === '1' || !!(timeline && timeline.classList.contains('expanded'));
  if (!wantsExpanded) return;
  const backendId = backendIdOf(assistantMessageId);
  if (!backendId) return;
  triggerLazyProcessDetailsLoad(deps, assistantMessageId, backendId, detailsContainer);
}

/** Waits (for up to five seconds) until the message has its backend id, then starts the lazy load. */
export function scheduleProcessDetailsLoadWhenReady(deps: LoadDeps, assistantMessageId: string, detailsContainer: HTMLElement, attempt: number, backendIdOf: (id: string) => string): void {
  if (!assistantMessageId || !detailsContainer) return;
  if (attempt > 25) return;
  const backendId = backendIdOf(assistantMessageId);
  if (backendId) {
    triggerLazyProcessDetailsLoad(deps, assistantMessageId, backendId, detailsContainer);
    return;
  }
  deps.setTimeout(() => scheduleProcessDetailsLoadWhenReady(deps, assistantMessageId, detailsContainer, attempt + 1, backendIdOf), 200);
}

/** Opens or closes a message's details: a first open of a lazy message loads it, and the summary and return control follow. */
export function toggleProcessDetails(deps: LoadDeps, assistantMessageId: string, backendIdOf: (id: string) => string, updateReturn: boolean): void {
  const detailsContainer = deps.doc.getElementById('process-details-' + assistantMessageId) as HTMLElement | null;
  if (!detailsContainer) return;
  const expandT = deps.tr('chat.expandDetail', 'Expand details');
  const collapseT = deps.tr('tasks.collapseDetail', 'Collapse details');

  const maybeLazy = detailsContainer.dataset && detailsContainer.dataset.lazyNotLoaded === '1' && detailsContainer.dataset.loaded !== '1';
  if (maybeLazy) {
    const backendMessageId = backendIdOf(assistantMessageId);
    if (backendMessageId) triggerLazyProcessDetailsLoad(deps, assistantMessageId, backendMessageId, detailsContainer);
    else scheduleProcessDetailsLoadWhenReady(deps, assistantMessageId, detailsContainer, 0, backendIdOf);
  }

  const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
  const detailBtns = deps.doc.querySelectorAll<HTMLElement>(`#${assistantMessageId} .process-detail-btn`);
  const setDetailBtnLabels = (label: string) => {
    detailBtns.forEach(btn => { btn.innerHTML = '<span>' + label + '</span>'; });
  };
  const setExpanded = (expanded: boolean) => {
    if (!timeline) return;
    if (expanded) {
      timeline.classList.add('expanded');
      detailsContainer.dataset.userExpanded = '1';
      setDetailBtnLabels(collapseT);
    } else {
      timeline.classList.remove('expanded');
      delete detailsContainer.dataset.userExpanded;
      setDetailBtnLabels(expandT);
    }
  };
  if (timeline) setExpanded(!timeline.classList.contains('expanded'));
  if (timeline && updateReturn) deps.updateReturnControl(timeline);
  deps.syncTurnSummary(deps.doc.getElementById(assistantMessageId) as HTMLElement | null);

  // Scroll to the opened details, but a streaming reader who scrolled up keeps their place.
  if (timeline && timeline.classList.contains('expanded')) {
    deps.setTimeout(() => {
      if (!deps.scrollIntoViewIfFollowing(detailsContainer, { behavior: 'smooth', block: 'nearest' }) && deps.capturePinned()) {
        detailsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  }
}

/** Asks for a stop: a task with no conversation yet cannot be stopped, so the stop is held and the user is told. */
export function cancelProgressTask(deps: LoadDeps, progressId: string): void {
  const state = deps.progressState(progressId);
  const stopBtn = deps.stopButtonFor(progressId);
  if (!state || !state.conversationId) {
    if (stopBtn) {
      stopBtn.disabled = true;
      deps.setTimeout(() => { stopBtn.disabled = false; }, 1500);
    }
    deps.alert(deps.tr('tasks.taskInfoNotSynced', 'Task info not synced yet, please try again later.'));
    return;
  }
  if (state.cancelling) return;
  deps.openUserInterrupt(progressId, state.conversationId);
}
