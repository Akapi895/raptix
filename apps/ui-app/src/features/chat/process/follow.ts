// The follow of the latest round while a turn runs: the process details of a turn keep their newest round in view as it grows,
// until the reader scrolls up on purpose. A restored run follows for a while; a live progress follows for as long as it runs.

import { createReturnLatestController, FOLLOW_RESUME_THRESHOLD_PX, type FollowView } from './return-latest';

export const RESTORE_FOLLOW_MS = 6000;
const SCROLLBAR_GUTTER_PX = 18;

export interface FollowState extends FollowView {
  persistent: boolean;
  hasPendingNewBelow: boolean;
  touchLastY: number | null;
  userScrollIntentUntil: number;
  rafId: number;
  timeoutId: number;
  observer: MutationObserver | null;
  resizeObserver: ResizeObserver | null;
  cleanup: (() => void)[];
  scheduleFollowLatest?: () => void;
}

export interface FollowDeps {
  doc: Document;
  returnLatest: ReturnType<typeof createReturnLatestController>;
  /** Scrolls the chat's outer column when it is pinned to the bottom. */
  scrollChatIfPinned(): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  now(): number;
}

export function createProcessFollow(deps: FollowDeps) {
  const states = new Map<string, FollowState>();
  const { returnLatest } = deps;

  /** Scrolls the details of an assistant message to their latest round; the return control follows. */
  function scrollToLatest(assistantMessageId: string, smooth = true): boolean {
    const container = deps.doc.getElementById('process-details-' + assistantMessageId);
    const timeline = container?.querySelector<HTMLElement>('.progress-timeline');
    if (!timeline) return false;
    returnLatest.scrollToLatestRound(timeline, smooth);
    const state = returnLatest.controls.get(timeline);
    if (state) {
      state.hasPendingNewBelow = false;
      returnLatest.updateReturnLatestControl(timeline);
    }
    return true;
  }

  /** Stops one follow: its frame and timers, its observers and its listeners. */
  function stop(key: string): boolean {
    const state = states.get(key);
    if (!state) return false;
    state.stopped = true;
    if (state.rafId) deps.cancelFrame(state.rafId);
    if (state.timeoutId) deps.clearTimeout(state.timeoutId);
    state.observer?.disconnect();
    state.resizeObserver?.disconnect();
    state.cleanup.forEach(cleanup => {
      try {
        cleanup();
      } catch {
        // A listener that is already gone needs no cleanup.
      }
    });
    states.delete(key);
    return true;
  }

  function stopAll(): void {
    Array.from(states.keys()).forEach(stop);
  }

  /**
   * Keeps a timeline on its latest round. The inner timeline and the chat column stick to the bottom separately; once the reader
   * scrolls up in the inner one, both stop following.
   */
  function start(assistantMessageId: string, options: {
    stateKey?: string;
    timeline?: HTMLElement | null;
    persistent?: boolean;
    durationMs?: number;
    scrollToLatest?: (timeline: HTMLElement) => void;
  } = {}): boolean {
    const key = String(options.stateKey || assistantMessageId || '');
    if (!key) return false;
    const explicitTimeline = options.timeline && options.timeline.nodeType === 1 ? options.timeline : null;
    const container = explicitTimeline
      ? explicitTimeline.closest<HTMLElement>('.progress-container, .process-details-container')
      : deps.doc.getElementById('process-details-' + key);
    const timeline = explicitTimeline || (container && container.querySelector<HTMLElement>('.progress-timeline'));
    if (!container || !timeline) return false;

    stop(key);
    returnLatest.ensureReturnLatestControl(timeline);
    const persistent = !!options.persistent;
    const durationMs = Number.isFinite(Number(options.durationMs)) ? Math.max(250, Number(options.durationMs)) : RESTORE_FOLLOW_MS;
    const state: FollowState = {
      stopped: false,
      detached: false,
      persistent,
      timeline,
      hasPendingNewBelow: false,
      lastScrollTop: timeline.scrollTop,
      userScrollIntentUntil: 0,
      touchLastY: null,
      rafId: 0,
      timeoutId: 0,
      observer: null,
      resizeObserver: null,
      cleanup: [],
    };
    states.set(key, state);

    const detachForUserNavigation = () => {
      state.detached = true;
      if (state.rafId) {
        deps.cancelFrame(state.rafId);
        state.rafId = 0;
      }
      returnLatest.updateReturnLatestControl(timeline);
    };
    const onWheel = (event: WheelEvent) => {
      if (!event) return;
      if (Math.abs(event.deltaY) > 1) state.userScrollIntentUntil = deps.now() + 1200;
      if (event.deltaY < -1) detachForUserNavigation();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!event) return;
      const rect = timeline.getBoundingClientRect();
      if (event.clientX >= rect.right - SCROLLBAR_GUTTER_PX) state.userScrollIntentUntil = deps.now() + 1800;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event) return;
      if (['ArrowUp', 'PageUp', 'Home', 'ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) state.userScrollIntentUntil = deps.now() + 1200;
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') detachForUserNavigation();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (!event || !event.touches || event.touches.length !== 1) return;
      state.touchLastY = event.touches[0]?.clientY ?? null;
      state.userScrollIntentUntil = deps.now() + 1200;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!event || !event.touches || event.touches.length !== 1) return;
      const nextY = event.touches[0]?.clientY ?? 0;
      state.userScrollIntentUntil = deps.now() + 1200;
      if (state.touchLastY != null && nextY > state.touchLastY + 4) detachForUserNavigation();
      state.touchLastY = nextY;
    };
    const onTouchEnd = () => {
      state.touchLastY = null;
    };
    const onScroll = () => {
      if (state.stopped) return;
      const currentTop = timeline.scrollTop;
      const scrolledUp = currentTop < state.lastScrollTop - 1;
      const scrolledDown = currentTop > state.lastScrollTop + 1;
      const distance = Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);
      // The first small scroll up may still be inside the threshold of the bottom; a reader who leaves and comes back in the
      // same event must not be pulled back. A layout scroll with no reader input keeps the follow, and only an intent or a
      // detached state stops it.
      if (scrolledUp && (state.detached || deps.now() <= state.userScrollIntentUntil)) {
        detachForUserNavigation();
      } else if (
        state.detached &&
        scrolledDown &&
        deps.now() <= state.userScrollIntentUntil &&
        distance <= FOLLOW_RESUME_THRESHOLD_PX
      ) {
        state.detached = false;
        state.hasPendingNewBelow = false;
        scheduleFollowLatest();
      }
      if (distance <= FOLLOW_RESUME_THRESHOLD_PX) state.hasPendingNewBelow = false;
      state.lastScrollTop = currentTop;
      returnLatest.updateReturnLatestControl(timeline);
    };
    const listeners: [string, EventListener, AddEventListenerOptions | undefined][] = [
      ['wheel', onWheel as EventListener, { passive: true }],
      ['pointerdown', onPointerDown as EventListener, { passive: true }],
      ['keydown', onKeyDown as EventListener, undefined],
      ['touchstart', onTouchStart as EventListener, { passive: true }],
      ['touchmove', onTouchMove as EventListener, { passive: true }],
      ['touchend', onTouchEnd, { passive: true }],
      ['scroll', onScroll, { passive: true }],
    ];
    for (const [name, handler, opts] of listeners) {
      timeline.addEventListener(name, handler, opts);
      state.cleanup.push(() => timeline.removeEventListener(name, handler));
    }

    const followLatest = () => {
      state.rafId = 0;
      if (state.stopped || !timeline.isConnected) {
        stop(key);
        return;
      }
      if (state.detached) return;
      if (typeof options.scrollToLatest === 'function') options.scrollToLatest(timeline);
      else scrollToLatest(String(assistantMessageId || ''), false);
      state.hasPendingNewBelow = false;
      state.lastScrollTop = timeline.scrollTop;
      returnLatest.updateReturnLatestControl(timeline);
      deps.scrollChatIfPinned();
    };
    const scheduleFollowLatest = () => {
      if (state.stopped || state.rafId) return;
      if (state.detached) {
        state.hasPendingNewBelow = true;
        returnLatest.markPending(timeline);
        return;
      }
      state.rafId = deps.requestFrame(followLatest);
    };
    state.scheduleFollowLatest = scheduleFollowLatest;

    state.observer = new MutationObserver(scheduleFollowLatest);
    state.observer.observe(timeline, { childList: true, subtree: true, characterData: true });
    if (typeof ResizeObserver === 'function') {
      state.resizeObserver = new ResizeObserver(scheduleFollowLatest);
      state.resizeObserver.observe(timeline);
    }
    scheduleFollowLatest();

    if (!persistent) {
      state.timeoutId = deps.setTimeout(() => stop(key), durationMs);
    }
    return true;
  }

  const liveKey = (progressId: string) => 'live-progress:' + String(progressId || '');

  /** Keeps a live progress on its newest round for as long as it runs. */
  function startLive(progressId: string): boolean {
    const id = String(progressId || '');
    const timeline = id ? deps.doc.getElementById(id + '-timeline') as HTMLElement | null : null;
    if (!timeline) return false;
    return start(id, {
      stateKey: liveKey(id),
      timeline,
      persistent: true,
      scrollToLatest: target => {
        target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      },
    });
  }

  function stopLive(progressId: string): boolean {
    return stop(liveKey(progressId));
  }

  return {
    states,
    start,
    stop,
    stopAll,
    startLive,
    stopLive,
    scrollToLatest,
    /** The follow states, for the return control. */
    followStates: (): Iterable<FollowState> => states.values(),
  };
}
