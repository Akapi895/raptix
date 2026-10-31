// The process details of a turn, as the reader moves through them: the "back to the latest round" button that shows when the
// reader is away from the bottom of a running timeline, the scroll to the latest round, and the loader that fetches the older
// or newer pages when the reader reaches the top or the bottom. The timeline's element is the owner of each piece of state.

/** Within this many pixels of the bottom the reader counts as being at the latest round. */
export const FOLLOW_RESUME_THRESHOLD_PX = 2;

export interface ReturnLatestState {
  container: HTMLElement;
  host: HTMLElement;
  button: HTMLButtonElement;
  hasPendingNewBelow: boolean;
  resizeObserver: ResizeObserver | null;
  mutationObserver: MutationObserver | null;
}

/** The follow state that a timeline has, as the scroll follow keeps it. */
export interface FollowView {
  timeline: HTMLElement;
  detached: boolean;
  stopped: boolean;
  scheduleFollowLatest?: () => void;
  lastScrollTop: number;
}

export interface ReturnLatestDeps {
  doc: Document;
  label(): string;
  /** The follow states that are live now. */
  followStates(): Iterable<FollowView>;
  /** Whether a container is streaming. */
  isStreaming(container: HTMLElement): boolean;
  /** Loads one page next to the shown ones. */
  loadPage(assistantMessageId: string, backendMessageId: string, options: { prepend: boolean; append: boolean; autoLoadAll: boolean }): Promise<unknown>;
  /** The label of a loading state, or of the retry. */
  continuousLabel(kind: 'older' | 'newer' | 'retry'): string;
  /** A translation for the load-more buttons when there is no intersection observer. */
  loadMoreLabel(kind: 'older' | 'newer'): string;
  documentOf(element: Element): Document;
  root(): HTMLElement | null;
  setTimeout(callback: () => void, ms: number): unknown;
}

/** The return-to-latest control of each timeline, the pagination observers, and their state. */
export function createReturnLatestController(deps: ReturnLatestDeps) {
  const controls = new WeakMap<HTMLElement, ReturnLatestState>();
  const autoLoaders = new WeakMap<HTMLElement, IntersectionObserver>();

  const followStateOf = (timeline: HTMLElement): FollowView | null => {
    let matched: FollowView | null = null;
    for (const state of deps.followStates()) {
      if (!matched && state && state.timeline === timeline && !state.stopped) matched = state;
    }
    return matched;
  };

  /** How far the timeline is from its latest round. */
  function distanceFromLatest(timeline: HTMLElement): number {
    if (!timeline) return 0;
    return Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
  }

  /** Shows the button when the reader is away from the latest round of an expanded, scrollable timeline. */
  function updateReturnLatestControl(timeline: HTMLElement): boolean {
    const state = controls.get(timeline);
    if (!state || !state.button) return false;
    const scrollable = timeline.scrollHeight > timeline.clientHeight + 2;
    const awayFromLatest = distanceFromLatest(timeline) > FOLLOW_RESUME_THRESHOLD_PX;
    const expanded = timeline.classList && timeline.classList.contains('expanded');
    const followState = followStateOf(timeline);
    // While a running timeline sticks to the bottom it may briefly leave it between a mutation and the next frame, so the button
    // stays hidden until the reader has moved away on purpose.
    const followingLatest = !!(followState && !followState.detached);
    const shouldShow = !followingLatest && expanded && scrollable && awayFromLatest;
    const label = deps.label();
    state.button.hidden = !shouldShow;
    state.button.title = label;
    state.button.setAttribute('aria-label', label);
    state.button.classList.toggle('has-pending-new', shouldShow && state.hasPendingNewBelow);
    state.button.classList.toggle('is-streaming', shouldShow && deps.isStreaming(state.container));
    return shouldShow;
  }

  /** The reader came back to the bottom by hand: the follow of the timeline resumes. */
  function syncAfterManualReturn(timeline: HTMLElement): void {
    for (const state of deps.followStates()) {
      if (!state || state.timeline !== timeline) continue;
      state.detached = false;
      state.lastScrollTop = timeline.scrollTop;
      if (!state.stopped && typeof state.scheduleFollowLatest === 'function') state.scheduleFollowLatest();
    }
  }

  /** A new round arrived while the reader is away: the button says so. */
  function markPending(timeline: HTMLElement): boolean {
    const state = controls.get(timeline);
    if (!state) return false;
    if (distanceFromLatest(timeline) > FOLLOW_RESUME_THRESHOLD_PX) state.hasPendingNewBelow = true;
    updateReturnLatestControl(timeline);
    return true;
  }

  /** Puts the return control into a timeline the first time it is needed. */
  function ensureReturnLatestControl(timeline: HTMLElement | null | undefined): boolean {
    if (!timeline || timeline.nodeType !== 1) return false;
    const existing = controls.get(timeline);
    if (existing) {
      updateReturnLatestControl(timeline);
      return true;
    }
    const doc = deps.documentOf(timeline);
    const container = timeline.closest<HTMLElement>('.progress-container, .process-details-container');
    const host = (container && container.querySelector<HTMLElement>('.process-details-content')) || container || timeline.parentElement;
    if (!host) return false;
    host.classList.add('process-details-return-latest-host');

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'process-details-return-latest';
    button.hidden = true;
    button.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    host.appendChild(button);

    const state: ReturnLatestState = {
      container: container || host,
      host,
      button,
      hasPendingNewBelow: false,
      resizeObserver: null,
      mutationObserver: null,
    };
    controls.set(timeline, state);

    const clearPointer = (event?: Event) => {
      if (event) event.stopPropagation();
    };
    const scrollToLatest = (event?: Event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const targetTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
      if (typeof timeline.scrollTo === 'function') timeline.scrollTo({ top: targetTop, behavior: 'smooth' });
      else timeline.scrollTop = targetTop;
      state.hasPendingNewBelow = false;
      syncAfterManualReturn(timeline);
      updateReturnLatestControl(timeline);
      deps.setTimeout(() => {
        if (timeline.isConnected) updateReturnLatestControl(timeline);
      }, 360);
      button.blur();
    };
    const onScroll = () => {
      if (distanceFromLatest(timeline) <= FOLLOW_RESUME_THRESHOLD_PX) state.hasPendingNewBelow = false;
      updateReturnLatestControl(timeline);
    };

    button.addEventListener('pointerdown', clearPointer);
    button.addEventListener('mousedown', clearPointer);
    button.addEventListener('touchstart', clearPointer, { passive: true });
    button.addEventListener('click', scrollToLatest);
    timeline.addEventListener('scroll', onScroll, { passive: true });
    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(() => updateReturnLatestControl(timeline));
      state.resizeObserver.observe(timeline);
    }
    if (typeof MutationObserver === 'function') {
      state.mutationObserver = new MutationObserver(() => updateReturnLatestControl(timeline));
      state.mutationObserver.observe(timeline, { childList: true, subtree: true, characterData: true });
    }
    updateReturnLatestControl(timeline);
    return true;
  }

  /** Scrolls the timeline of a conversation's details to its latest round. */
  function scrollToLatestRound(timeline: HTMLElement, smooth: boolean): void {
    const targetTop = Math.max(0, timeline.scrollHeight - timeline.clientHeight);
    if (smooth && typeof timeline.scrollTo === 'function') timeline.scrollTo({ top: targetTop, behavior: 'smooth' });
    else timeline.scrollTop = targetTop;
  }

  /** Makes a container's pagination buttons match the pages that exist, and watches its sentinels. */
  function updatePaginationButtons(
    doc: Document,
    detailsContainer: HTMLElement,
    assistantMessageId: string,
    backendMessageId: string,
    pageState: { hasPrev?: boolean; hasNext?: boolean },
  ): void {
    const timeline = detailsContainer.querySelector<HTMLElement>('.progress-timeline');
    if (!timeline) return;
    detailsContainer.dataset.hasPrev = pageState.hasPrev ? '1' : '0';
    detailsContainer.dataset.hasNext = pageState.hasNext ? '1' : '0';

    detailsContainer.querySelectorAll('.process-details-load-prev-btn, .process-details-load-more-btn').forEach(el => el.remove());
    timeline.querySelectorAll('.process-details-auto-sentinel').forEach(el => el.remove());
    disconnectAutoLoader(detailsContainer);

    let topSentinel: HTMLButtonElement | null = null;
    let bottomSentinel: HTMLButtonElement | null = null;
    if (pageState.hasPrev) {
      topSentinel = doc.createElement('button');
      topSentinel.type = 'button';
      topSentinel.className = 'process-details-auto-sentinel process-details-auto-sentinel--top';
      topSentinel.setAttribute('aria-label', deps.continuousLabel('older'));
      topSentinel.textContent = deps.continuousLabel('older');
      timeline.prepend(topSentinel);
    }
    if (pageState.hasNext) {
      bottomSentinel = doc.createElement('button');
      bottomSentinel.type = 'button';
      bottomSentinel.className = 'process-details-auto-sentinel process-details-auto-sentinel--bottom';
      bottomSentinel.setAttribute('aria-label', deps.continuousLabel('newer'));
      bottomSentinel.textContent = deps.continuousLabel('newer');
      timeline.appendChild(bottomSentinel);
    }

    if (typeof IntersectionObserver === 'function' && (topSentinel || bottomSentinel)) {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          if (detailsContainer.dataset.autoLoadSuspended === '1') return;
          if (entry.target === topSentinel) void requestAutoPage(assistantMessageId, backendMessageId, 'prev', topSentinel);
          else if (entry.target === bottomSentinel) void requestAutoPage(assistantMessageId, backendMessageId, 'next', bottomSentinel);
        });
      }, { root: deps.root(), rootMargin: '180px 0px', threshold: 0.01 });
      if (topSentinel) observer.observe(topSentinel);
      if (bottomSentinel) observer.observe(bottomSentinel);
      autoLoaders.set(detailsContainer, observer);
    } else {
      if (topSentinel) {
        topSentinel.textContent = deps.loadMoreLabel('older');
        topSentinel.onclick = () => { void requestAutoPage(assistantMessageId, backendMessageId, 'prev', topSentinel); };
      }
      if (bottomSentinel) {
        bottomSentinel.textContent = deps.loadMoreLabel('newer');
        bottomSentinel.onclick = () => { void requestAutoPage(assistantMessageId, backendMessageId, 'next', bottomSentinel); };
      }
    }
  }

  function disconnectAutoLoader(detailsContainer: HTMLElement | null | undefined): void {
    if (!detailsContainer) return;
    const old = autoLoaders.get(detailsContainer);
    if (old) {
      old.disconnect();
      autoLoaders.delete(detailsContainer);
    }
  }

  /** Loads the page next to the shown ones when its sentinel is reached; a failed page can be retried from the sentinel. */
  async function requestAutoPage(assistantMessageId: string, backendMessageId: string, direction: 'prev' | 'next', sentinel: HTMLElement | null): Promise<void> {
    const detailsContainer = deps.doc.getElementById('process-details-' + assistantMessageId);
    if (!detailsContainer || !sentinel) return;
    const loadingKey = direction === 'prev' ? 'loadingPrev' : 'loadingMore';
    const hasKey = direction === 'prev' ? 'hasPrev' : 'hasNext';
    if (detailsContainer.dataset[hasKey] !== '1' || detailsContainer.dataset[loadingKey] === '1') return;
    detailsContainer.dataset[loadingKey] = '1';
    sentinel.classList.add('is-loading');
    sentinel.textContent = deps.continuousLabel(direction === 'prev' ? 'older' : 'newer');
    try {
      await deps.loadPage(assistantMessageId, backendMessageId, { prepend: direction === 'prev', append: direction === 'next', autoLoadAll: false });
    } catch (e) {
      console.error('Failed to auto-load process details:', e);
      sentinel.classList.remove('is-loading');
      sentinel.classList.add('is-error');
      sentinel.textContent = deps.continuousLabel('retry');
      sentinel.onclick = () => {
        sentinel.onclick = null;
        sentinel.classList.remove('is-error');
        void requestAutoPage(assistantMessageId, backendMessageId, direction, sentinel);
      };
    } finally {
      detailsContainer.dataset[loadingKey] = '0';
    }
  }

  return {
    distanceFromLatest,
    followStateOf,
    updateReturnLatestControl,
    syncAfterManualReturn,
    markPending,
    ensureReturnLatestControl,
    scrollToLatestRound,
    updatePaginationButtons,
    disconnectAutoLoader,
    requestAutoPage,
    controls,
  };
}
