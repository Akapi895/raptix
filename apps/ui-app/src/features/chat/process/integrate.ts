// Where the process of a finished turn ends up: the progress card leaves the conversation, its details join the tool-call area
// of the answer, and the answer's timing and detail toggles are set. The page's own renderers come in through `deps`.

import type { TimelineTranslate } from '../timeline/tool-result';

export interface IntegrateDeps {
  doc: Document;
  t: TimelineTranslate;
  flushStreamText(): void;
  finalizeOutstandingToolCalls(progressId: string, status: string): void;
  removeMessage(progressId: string): void;
  stopElapsedClock(progressId: string): void;
  syncElapsedSummary(progressId: string): void;
  stopLiveFollow(progressId: string): void;
  updateReturnControl(timeline: HTMLElement): void;
  ensureMcpChrome(assistantElement: HTMLElement, assistantId: string): void;
  setMcpExecutionIds(assistantElement: HTMLElement, ids: string[]): void;
  syncMcpToolsToggle(assistantElement: HTMLElement): void;
  toggleProcessDetails(progressId: string | null, assistantId: string): void;
  renderProcessDetails(assistantId: string, details: null): void;
  hasRenderProcessDetails(): boolean;
  bindLazyHint(timeline: HTMLElement, assistantId: string): void;
  syncTurnSummary(assistantElement: HTMLElement | null): void;
  setTurnTiming(assistantElement: HTMLElement, timing: { startedAt: string; completedAt: string; durationMs: number; status: string }): void;
  now(): number;
}

/** Shows or hides the process details of a progress, and keeps its summary and the return control in step. */
export function toggleProgressDetails(deps: IntegrateDeps, progressId: string): void {
  const timeline = deps.doc.getElementById(progressId + '-timeline');
  const toggleBtns = deps.doc.querySelectorAll<HTMLElement>(`#${progressId} .progress-toggle`);
  if (!timeline || !toggleBtns.length) return;
  const expandT = deps.t('chat.expandDetail');
  const collapseT = deps.t('tasks.collapseDetail');
  if (timeline.classList.contains('expanded')) {
    timeline.classList.remove('expanded');
    toggleBtns.forEach(btn => { btn.textContent = expandT; });
  } else {
    timeline.classList.add('expanded');
    toggleBtns.forEach(btn => { btn.textContent = collapseT; });
  }
  deps.updateReturnControl(timeline);
  deps.syncElapsedSummary(progressId);
}

/** When the orchestrator starts its final reply, the progress message is hidden: its details now live in the answer bubble. */
export function hideProgressMessageForFinalReply(deps: IntegrateDeps, progressId: string): void {
  if (!progressId) return;
  deps.stopLiveFollow(progressId);
  const el = deps.doc.getElementById(progressId);
  if (el) el.style.display = 'none';
}

/** Collapses the process details of an assistant message, the detached detail components, and the progress itself. */
export function collapseAllProgressDetails(deps: IntegrateDeps, assistantMessageId: string | null, progressId: string | null, options: { force?: boolean } = {}): void {
  const doc = deps.doc;
  const forceCollapse = !!(options && options.force);
  if (assistantMessageId) {
    const detailsContainer = doc.getElementById('process-details-' + assistantMessageId);
    if (detailsContainer && (forceCollapse || detailsContainer.dataset.userExpanded !== '1')) {
      if (forceCollapse) delete detailsContainer.dataset.userExpanded;
      const timeline = detailsContainer.querySelector('.progress-timeline');
      if (timeline) {
        timeline.classList.remove('expanded');
        doc.querySelectorAll(`#${assistantMessageId} .process-detail-btn`).forEach(btn => {
          btn.innerHTML = '<span>' + deps.t('chat.expandDetail') + '</span>';
        });
      }
    }
    deps.syncTurnSummary(doc.getElementById(assistantMessageId));
  }

  doc.querySelectorAll<HTMLElement>('[id^="details-"]').forEach(detail => {
    const timeline = detail.querySelector('.progress-timeline');
    const toggleBtns = detail.querySelectorAll<HTMLElement>('.progress-toggle');
    if (timeline) {
      timeline.classList.remove('expanded');
      const expandT = deps.t('chat.expandDetail');
      toggleBtns.forEach(btn => { btn.textContent = expandT; });
    }
  });

  if (progressId) {
    const progressTimeline = doc.getElementById(progressId + '-timeline');
    const progressToggleBtns = doc.querySelectorAll<HTMLElement>(`#${progressId} .progress-toggle`);
    if (progressTimeline) {
      progressTimeline.classList.remove('expanded');
      const expandT = deps.t('chat.expandDetail');
      progressToggleBtns.forEach(btn => { btn.textContent = expandT; });
    }
  }
}

/** The id of the newest assistant message, which a finished progress is attached to. */
export function getAssistantId(doc: Document): string | null {
  const messages = doc.querySelectorAll<HTMLElement>('.message.assistant');
  if (messages.length > 0) return messages[messages.length - 1]?.id ?? null;
  return null;
}

/** Writes the turn's timing onto the answer from the progress that produced it, and stops the progress clock. */
export function applyAssistantTurnTimingFromProgress(
  deps: IntegrateDeps,
  progressId: string,
  assistantElement: HTMLElement | null,
  terminalStatus: string,
  setTiming: boolean,
): void {
  const progressElement = deps.doc.getElementById(progressId);
  const progressStartedAt = progressElement && progressElement.dataset
    ? (progressElement.dataset.turnStartedAt || new Date(Number(progressElement.dataset.turnStartedAtMs) || deps.now()).toISOString())
    : new Date().toISOString();
  const progressStartedAtMs = progressElement && progressElement.dataset
    ? Number(progressElement.dataset.turnStartedAtMs)
    : deps.now();
  const completedAt = new Date();
  deps.stopElapsedClock(progressId);
  if (!assistantElement || !setTiming) return;
  deps.setTurnTiming(assistantElement, {
    startedAt: progressStartedAt,
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - (Number.isFinite(progressStartedAtMs) ? progressStartedAtMs : completedAt.getTime())),
    status: terminalStatus || 'completed',
  });
}

/**
 * Moves the process details of a finished progress into the tool-call area of its answer. The details are loaded from the
 * server later, so the live DOM of the progress is not copied; the progress card is then removed.
 */
export function integrateProgressToMCPSection(
  deps: IntegrateDeps,
  progressId: string,
  assistantMessageId: string,
  mcpExecutionIds: unknown,
  terminalStatus: string | undefined,
  setTiming: boolean,
): void {
  const doc = deps.doc;
  deps.stopElapsedClock(progressId);
  deps.flushStreamText();
  deps.finalizeOutstandingToolCalls(progressId, 'failed');

  const mcpIds = Array.isArray(mcpExecutionIds) ? mcpExecutionIds as string[] : [];
  const assistantElement = doc.getElementById(assistantMessageId) as HTMLElement | null;
  if (!assistantElement) {
    deps.removeMessage(progressId);
    return;
  }
  const contentWrapper = assistantElement.querySelector('.message-content');
  if (!contentWrapper) {
    deps.removeMessage(progressId);
    return;
  }

  deps.ensureMcpChrome(assistantElement, assistantMessageId);
  applyAssistantTurnTimingFromProgress(deps, progressId, assistantElement, terminalStatus || 'completed', setTiming);
  const mcpSection = assistantElement.querySelector<HTMLElement>('.mcp-call-section');
  if (!mcpSection) {
    deps.removeMessage(progressId);
    return;
  }

  if (mcpIds.length > 0) {
    deps.setMcpExecutionIds(assistantElement, mcpIds);
    const toolList = mcpSection.querySelector('.mcp-tool-list');
    if (toolList) toolList.classList.remove('expanded');
  }
  deps.syncMcpToolsToggle(assistantElement);

  const toolbar = mcpSection.querySelector('.mcp-call-toolbar');
  if (toolbar && !toolbar.querySelector('.process-detail-btn')) {
    const progressDetailBtn = doc.createElement('button');
    progressDetailBtn.className = 'mcp-detail-btn process-detail-btn';
    progressDetailBtn.innerHTML = '<span>' + deps.t('chat.expandDetail') + '</span>';
    progressDetailBtn.onclick = () => deps.toggleProcessDetails(null, assistantMessageId);
    toolbar.appendChild(progressDetailBtn);
  }

  const detailsId = 'process-details-' + assistantMessageId;
  let detailsContainer = doc.getElementById(detailsId);
  const toolListEl = mcpSection.querySelector('.mcp-tool-list');
  if (!detailsContainer) {
    detailsContainer = doc.createElement('div');
    detailsContainer.id = detailsId;
    detailsContainer.className = 'process-details-container';
    if (toolListEl) toolListEl.after(detailsContainer);
    else mcpSection.appendChild(detailsContainer);
  }

  if (deps.hasRenderProcessDetails()) {
    deps.renderProcessDetails(assistantMessageId, null);
  } else {
    detailsContainer.dataset.lazyNotLoaded = '1';
    detailsContainer.dataset.loaded = '0';
    detailsContainer.innerHTML = `
            <div class="process-details-content">
                <div class="progress-timeline" id="${detailsId}-timeline">
                    <div class="progress-timeline-empty">${deps.t('chat.expandDetailLazyHint')}</div>
                </div>
            </div>
        `;
    const tl = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
    if (tl) deps.bindLazyHint(tl, assistantMessageId);
  }

  const expandLabel = deps.t('chat.expandDetail');
  doc.querySelectorAll(`#${assistantMessageId} .process-detail-btn`).forEach(btn => {
    btn.innerHTML = '<span>' + expandLabel + '</span>';
  });
  deps.removeMessage(progressId);
}
