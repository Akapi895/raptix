/**
 * Smart stick-to-bottom scrolling for the main conversation area: auto-follow while streaming,
 * never stealing focus while the user scrolls up to read. Shared by the main POST stream
 * (sendMessage) and the post-refresh task-events replay stream.
 */
import type { AddMessageOptions, Translate } from './types';
import { streamBelongsToConversation, type ScrollStream } from './scroll-state';

export interface ScrollDependencies {
    translate?: Translate;
    conversationId(): string | null | undefined;
    liveStream(): ScrollStream | null | undefined;
    replayStream(): ScrollStream | null | undefined;
    setReplayStream(stream: ScrollStream): void;
    isTaskRunning(id: string): boolean;
}
export function createChatScroll(document: Document, deps: ScrollDependencies) {
    const browser = document.defaultView!;
    const lifecycle = new AbortController();
    let disposed = false;
    const frames = new Set<number>();
    const timers = new Set<number>();
    const requestAnimationFrame = (callback: FrameRequestCallback): number => {
        if (disposed) return 0;
        const id = browser.requestAnimationFrame(time => { frames.delete(id); if (!disposed) callback(time); });
        frames.add(id); return id;
    };
    const cancelAnimationFrame = (id: number) => { browser.cancelAnimationFrame(id); frames.delete(id); };
    const setTimeout = (callback: () => void, delay: number): number => {
        const id = browser.setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, delay);
        timers.add(id); return id;
    };
    const clearTimeout = (id: number) => { browser.clearTimeout(id); timers.delete(id); };
    let touchLastY: number | null = null;
    interface Turn { user: HTMLElement; assistants: HTMLElement[] }

    /** Keep auto-following only within this distance from the bottom (keep it small so near-bottom reading is not yanked back) */
    const CHAT_SCROLL_FOLLOW_THRESHOLD_PX = 48;
    /** Resume following only when truly at the bottom; the 2px slack tolerates sub-pixel scrolling on high-DPI screens. */
    const CHAT_SCROLL_FOLLOW_RESUME_THRESHOLD_PX = 2;
    /** Within this distance of the bottom counts as being at the latest turn */
    const CHAT_SCROLL_NAV_BOTTOM_THRESHOLD_PX = 120;
    /** Short lock after the user scrolls up, preventing SSE/scroll event races from stealing the scroll position */
    const DETACH_LOCK_MS = 900;
    /** Restore after refresh spans several async layout passes: history messages, process details, fonts and stream subscriptions. */
    const CONVERSATION_RESTORE_SETTLE_MIN_MS = 3000;
    const CONVERSATION_RESTORE_SETTLE_MAX_MS = 6000;
    const CONVERSATION_RESTORE_STABLE_FRAMES = 12;

    /** @type {'following' | 'detached'} */
    let scrollMode = 'following';
    let scrollFollowRaf = 0;
    let scrollSettleGeneration = 0;
    let conversationRestoreGeneration = 0;
    /** Whether new output arrived below after the user detached (counted once, not per SSE event) */
    let hasPendingNewBelow = false;
    let listenersBound = false;
    let lastScrollTop = 0;
    let lastScrollHeight = 0;
    let programmaticScroll = false;
    let detachLockUntil = 0;
    /** Timestamp of the latest user-initiated scroll intent; layout changes or scripted scrolling must not restore stick-to-bottom from it. */
    let userScrollIntentUntil = 0;
    let turnRailRefreshRaf = 0;
    let turnRailSignature = '';
    let activeTurnIndex = -1;
    let turnRailObserver: MutationObserver | null = null;
    let chatMessagesResizeObserver: ResizeObserver | null = null;
    let turnPreviewHideTimer = 0;

    function getChatMessagesEl() {
        return document.getElementById('chat-messages');
    }

    function getTurnRailEl() {
        return document.getElementById('chat-turn-rail');
    }

    function getTurnRailMarkersEl() {
        return document.getElementById('chat-turn-rail-markers');
    }

    function getReturnLatestButton() {
        return document.getElementById('chat-return-latest');
    }

    function normalizePreviewText(value: unknown) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function trimPreviewText(value: unknown, maxLength: number) {
        const text = normalizePreviewText(value);
        if (text.length <= maxLength) return text;
        return text.slice(0, Math.max(1, maxLength - 1)).trimEnd() + '…';
    }

    function messagePreviewText(messageEl: HTMLElement | null | undefined) {
        if (!messageEl) return '';
        const original = messageEl.dataset ? messageEl.dataset.originalContent : '';
        if (original) return normalizePreviewText(original);
        const bubble = messageEl.querySelector('.assistant-final-result, .message-bubble');
        if (!bubble) return '';
        const clone = bubble.cloneNode(true) as Element;
        clone.querySelectorAll('button, .message-copy-btn, .progress-actions, .progress-footer, .process-details-content').forEach(function (el) {
            el.remove();
        });
        return normalizePreviewText(clone.textContent);
    }

    /** Each user message starts a turn; assistant messages before the next user message belong to that turn. */
    function collectConversationTurns() {
        const messagesEl = getChatMessagesEl();
        if (!messagesEl) return [];
        const turns: Turn[] = [];
        let currentTurn: Turn | null = null;
        Array.from(messagesEl.children).forEach(function (messageEl) {
            if (!(messageEl instanceof HTMLElement) || !messageEl.classList.contains('message')) return;
            if (messageEl.classList.contains('user')) {
                currentTurn = { user: messageEl, assistants: [] };
                turns.push(currentTurn);
                return;
            }
            if (currentTurn && messageEl.classList.contains('assistant')) {
                currentTurn.assistants.push(messageEl);
            }
        });
        return turns;
    }

    function localizedTurnLabel(index: number, question: string) {
        const number = index + 1;
        const prefix = deps.translate
            ? deps.translate('chat.turnNumber', { number: number })
            : `Turn ${number}`;
        const safePrefix = prefix && prefix !== 'chat.turnNumber' ? prefix : (`Turn ${number}`);
        return question ? safePrefix + ': ' + question : safePrefix;
    }

    function turnPreviewData(turn: Turn, index: number) {
        const question = trimPreviewText(messagePreviewText(turn && turn.user), 100)
            || localizedTurnLabel(index, '');
        const assistants = turn && turn.assistants ? turn.assistants : [];
        let assistant: HTMLElement | null | undefined = null;
        for (let i = assistants.length - 1; i >= 0; i--) {
            if (!assistants[i]!.classList.contains('progress-message')) {
                assistant = assistants[i];
                break;
            }
        }
        if (!assistant && assistants.length) assistant = assistants[assistants.length - 1];
        let summary = trimPreviewText(messagePreviewText(assistant), 220);
        if (!summary) {
            summary = deps.translate ? deps.translate('chat.turnPending') : 'Working…';
            if (!summary || summary === 'chat.turnPending') summary = 'Working…';
        }
        return { question: question, summary: summary };
    }

    function hideTurnPreview() {
        if (turnPreviewHideTimer) {
            clearTimeout(turnPreviewHideTimer);
            turnPreviewHideTimer = 0;
        }
        const preview = document.getElementById('chat-turn-rail-preview');
        if (preview) preview.hidden = true;
    }

    function scheduleHideTurnPreview() {
        if (turnPreviewHideTimer) clearTimeout(turnPreviewHideTimer);
        turnPreviewHideTimer = setTimeout(hideTurnPreview, 160);
    }

    function showTurnPreview(marker: HTMLElement, index: number) {
        if (turnPreviewHideTimer) {
            clearTimeout(turnPreviewHideTimer);
            turnPreviewHideTimer = 0;
        }
        const preview = document.getElementById('chat-turn-rail-preview');
        const title = document.getElementById('chat-turn-rail-preview-title');
        const summary = document.getElementById('chat-turn-rail-preview-summary');
        const turn = collectConversationTurns()[index];
        if (!preview || !title || !summary || !marker || !turn) return;

        const data = turnPreviewData(turn, index);
        title.textContent = data.question;
        summary.textContent = data.summary;
        preview.hidden = false;

        const markerRect = marker.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        const left = Math.min(markerRect.right + 18, browser.innerWidth - previewRect.width - 12);
        const desiredTop = markerRect.top + markerRect.height / 2 - previewRect.height / 2;
        const top = Math.max(12, Math.min(desiredTop, browser.innerHeight - previewRect.height - 12));
        preview.style.left = Math.max(12, left) + 'px';
        preview.style.top = top + 'px';
    }

    function setActiveTurnMarker(index: number) {
        const markersEl = getTurnRailMarkersEl();
        if (!markersEl) return;
        const markers = Array.from(markersEl.querySelectorAll<HTMLElement>('.chat-turn-rail-marker'));
        if (!markers.length) return;
        const nextIndex = Math.max(0, Math.min(index, markers.length - 1));
        markers.forEach(function (marker, markerIndex) {
            const active = markerIndex === nextIndex;
            marker.classList.toggle('is-active', active);
            if (active) marker.setAttribute('aria-current', 'step');
            else marker.removeAttribute('aria-current');
        });
        markers[markers.length - 1]!.classList.toggle('has-pending-new', hasPendingNewBelow);

        if (activeTurnIndex !== nextIndex) {
            activeTurnIndex = nextIndex;
            const activeMarker = markers[nextIndex]!;
            const markerTop = activeMarker.offsetTop;
            const markerBottom = markerTop + activeMarker.offsetHeight;
            if (markerTop < markersEl.scrollTop) {
                markersEl.scrollTop = Math.max(0, markerTop - 8);
            } else if (markerBottom > markersEl.scrollTop + markersEl.clientHeight) {
                markersEl.scrollTop = markerBottom - markersEl.clientHeight + 8;
            }
        }
    }

    function updateTurnRailActive() {
        const messagesEl = getChatMessagesEl();
        const turns = collectConversationTurns();
        if (!messagesEl || !turns.length) return;
        if (isNearBottom(CHAT_SCROLL_NAV_BOTTOM_THRESHOLD_PX)) {
            setActiveTurnMarker(turns.length - 1);
            return;
        }
        const readingLine = messagesEl.scrollTop + messagesEl.clientHeight * 0.34;
        let index = 0;
        for (let i = 0; i < turns.length; i++) {
            if (turns[i]!.user.offsetTop <= readingLine) index = i;
            else break;
        }
        setActiveTurnMarker(index);
    }

    function jumpToConversationTurn(index: number) {
        const messagesEl = getChatMessagesEl();
        const turn = collectConversationTurns()[index];
        if (!messagesEl || !turn || !turn.user) return;
        setScrollDetached();
        programmaticScroll = true;
        messagesEl.scrollTo({
            top: Math.max(0, turn.user.offsetTop - 20),
            behavior: 'smooth'
        });
        setActiveTurnMarker(index);
        hideTurnPreview();
        setTimeout(function () {
            programmaticScroll = false;
            lastScrollTop = messagesEl.scrollTop;
            updateTurnRailActive();
        }, 420);
    }

    function focusTurnMarker(index: number) {
        const markersEl = getTurnRailMarkersEl();
        const marker = markersEl && markersEl.querySelector<HTMLElement>('.chat-turn-rail-marker[data-turn-index="' + index + '"]');
        if (marker) marker.focus();
    }

    function rebuildTurnRail(force?: boolean) {
        const rail = getTurnRailEl();
        const markersEl = getTurnRailMarkersEl();
        if (!rail || !markersEl) return;
        const turns = collectConversationTurns();
        rail.hidden = turns.length === 0;
        if (!turns.length) {
            markersEl.replaceChildren();
            turnRailSignature = '';
            activeTurnIndex = -1;
            hideTurnPreview();
            return;
        }

        const signature = turns.map(function (turn, index) {
            return (turn.user.id || ('turn-' + index)) + ':' + messagePreviewText(turn.user);
        }).join('|');
        if (!force && signature === turnRailSignature) {
            updateTurnRailActive();
            return;
        }

        const fragment = document.createDocumentFragment();
        turns.forEach(function (turn, index) {
            const marker = document.createElement('button');
            const question = trimPreviewText(messagePreviewText(turn.user), 88);
            marker.type = 'button';
            marker.className = 'chat-turn-rail-marker';
            marker.dataset.turnIndex = String(index);
            marker.setAttribute('aria-label', localizedTurnLabel(index, question));
            marker.addEventListener('click', function () {
                jumpToConversationTurn(index);
            });
            marker.addEventListener('mouseenter', function () {
                showTurnPreview(marker, index);
            });
            marker.addEventListener('mouseleave', scheduleHideTurnPreview);
            marker.addEventListener('keydown', function (event) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    focusTurnMarker(Math.min(turns.length - 1, index + 1));
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    focusTurnMarker(Math.max(0, index - 1));
                } else if (event.key === 'Home') {
                    event.preventDefault();
                    focusTurnMarker(0);
                } else if (event.key === 'End') {
                    event.preventDefault();
                    focusTurnMarker(turns.length - 1);
                }
            });
            fragment.appendChild(marker);
        });
        markersEl.replaceChildren(fragment);
        turnRailSignature = signature;
        activeTurnIndex = -1;
        updateTurnRailActive();
    }

    function scheduleTurnRailRefresh(force?: boolean) {
        cancelAnimationFrame(turnRailRefreshRaf);
        turnRailRefreshRaf = requestAnimationFrame(function () {
            rebuildTurnRail(force === true);
        });
    }

    function streamBelongsToVisibleConversation(stream: ScrollStream | null | undefined) {
        return streamBelongsToConversation(stream, deps.conversationId());
    }

    /** Only the visible conversation's main POST stream / task-events replay counts as actively streaming */
    function isStreamActive() {
        try {
            const live = deps.liveStream();
            if (streamBelongsToVisibleConversation(live)) return true;
            const replay = deps.replayStream();
            return streamBelongsToVisibleConversation(replay);
        } catch {
            return false;
        }
    }

    function isVisibleConversationTaskActive() {
        if (isStreamActive()) return true;
        try {
            const visibleConversationId = (deps.conversationId() || '').trim();
            if (!visibleConversationId) return false;
            return deps.isTaskRunning(visibleConversationId);
        } catch {
            return false;
        }
    }

    function distanceFromBottom(el: HTMLElement | null) {
        if (!el) return 0;
        const { scrollTop, scrollHeight, clientHeight } = el;
        return scrollHeight - clientHeight - scrollTop;
    }

    function isNearBottom(thresholdPx: number) {
        const el = getChatMessagesEl();
        if (!el) return true;
        return distanceFromBottom(el) <= thresholdPx;
    }

    function isChatMessagesPinnedToBottom() {
        return isNearBottom(CHAT_SCROLL_NAV_BOTTOM_THRESHOLD_PX);
    }

    /** Resume following when already at the bottom (fixes: manually scrolled to bottom while scrollMode is still detached) */
    function resumeFollowingIfAtBottom(thresholdPx?: number, userInitiated = false) {
        if (!userInitiated && Date.now() < detachLockUntil) return false;
        const threshold = Number.isFinite(Number(thresholdPx))
            ? Math.max(0, Number(thresholdPx))
            : CHAT_SCROLL_FOLLOW_RESUME_THRESHOLD_PX;
        if (!isNearBottom(threshold)) return false;
        // detached is the reading state after an explicit upward scroll. Layout changes, streaming
        // growth and mode switches must not auto-recover even if the viewport ends up near the
        // bottom; only an explicit user scroll to the bottom resumes following.
        if (scrollMode === 'detached') {
            if (!userInitiated) return false;
            setScrollFollowing();
        }
        return true;
    }

    function captureScrollPinState() {
        if (Date.now() < detachLockUntil) return false;
        return scrollMode === 'following';
    }

    function setScrollFollowing() {
        scrollMode = 'following';
        detachLockUntil = 0;
        userScrollIntentUntil = 0;
        hasPendingNewBelow = false;
        updateTurnRailState();
    }

    function markPendingNewBelow() {
        if (scrollMode !== 'detached') return;
        hasPendingNewBelow = true;
        updateTurnRailState();
    }

    function setScrollDetached() {
        scrollMode = 'detached';
        detachLockUntil = Date.now() + DETACH_LOCK_MS;
        cancelAnimationFrame(scrollFollowRaf);
        if (isStreamActive()) {
            hasPendingNewBelow = true;
        }
        updateTurnRailState();
    }

    function scrollChatToBottomInstant() {
        if (scrollMode !== 'following') return;
        const el = getChatMessagesEl();
        if (!el) return;
        programmaticScroll = true;
        el.scrollTop = el.scrollHeight;
        lastScrollTop = el.scrollTop;
        lastScrollHeight = el.scrollHeight;
        requestAnimationFrame(function () {
            programmaticScroll = false;
        });
    }

    function scrollChatToBottomSmooth() {
        const el = getChatMessagesEl();
        if (!el) return;
        programmaticScroll = true;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        requestAnimationFrame(function () {
            programmaticScroll = false;
            const node = getChatMessagesEl();
            if (node) {
                lastScrollTop = node.scrollTop;
                lastScrollHeight = node.scrollHeight;
            }
        });
    }

    function updateTurnRailState() {
        updateTurnRailActive();
        updateReturnLatestButton();
    }

    function updateReturnLatestButton() {
        const button = getReturnLatestButton();
        const messagesEl = getChatMessagesEl();
        if (!button || !messagesEl) return;
        const scrollable = messagesEl.scrollHeight > messagesEl.clientHeight + 2;
        const atLatest = isNearBottom(CHAT_SCROLL_FOLLOW_RESUME_THRESHOLD_PX);
        const readingDetachedHistory = scrollMode === 'detached' && !atLatest;
        const farFromLatestFallback = !isNearBottom(CHAT_SCROLL_NAV_BOTTOM_THRESHOLD_PX);
        const shouldShow = scrollable && (readingDetachedHistory || farFromLatestFallback);
        const streaming = shouldShow && isVisibleConversationTaskActive();
        button.hidden = !shouldShow;
        button.classList.toggle('is-streaming', streaming);
        button.classList.toggle('has-pending-new', shouldShow && hasPendingNewBelow);
    }

    function isolateReturnLatestPointerEvent(event: Event) {
        if (!event) return;
        // The button hides immediately after click. Stop pointer event propagation so that, in long
        // histories, the button hiding and the approval card reflow landing in the same frame cannot
        // cause a click-through.
        event.stopPropagation();
    }

    function onReturnLatestClick(event: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        forceScrollChatToBottom(true);
        const button = getReturnLatestButton();
        if (button) {
            button.hidden = true;
            button.blur();
        }
    }

    function canAutoScrollNow(wasPinnedBeforeDomUpdate?: boolean) {
        if (Date.now() < detachLockUntil) return false;
        if (scrollMode === 'detached') return false;
        if (wasPinnedBeforeDomUpdate === true) return true;
        return isNearBottom(CHAT_SCROLL_FOLLOW_THRESHOLD_PX);
    }

    function scheduleChatScrollToBottomIfFollowing(wasPinnedBeforeDomUpdate?: boolean) {
        if (!canAutoScrollNow(wasPinnedBeforeDomUpdate)) {
            markPendingNewBelow();
            return;
        }
        cancelAnimationFrame(scrollFollowRaf);
        scrollFollowRaf = requestAnimationFrame(scrollChatToBottomInstant);
    }

    /**
     * Long detail restoration / final-state reconciliation grows the DOM in batches across several
     * requestAnimationFrame passes. A single scroll-to-bottom may run before the last batch; keep
     * re-settling for a few frames while still following, and stop immediately once the user scrolls
     * up into detached so their reading position is never stolen back.
     */
    function settleChatToBottomIfFollowing(frameCount?: number) {
        const frames = Number.isFinite(Number(frameCount))
            ? Math.max(1, Math.min(30, Math.floor(Number(frameCount))))
            : 12;
        const generation = ++scrollSettleGeneration;

        function settleFrame(remaining: number) {
            if (generation !== scrollSettleGeneration) return;
            if (scrollMode !== 'following' || Date.now() < detachLockUntil) return;
            scrollChatToBottomInstant();
            if (remaining > 1) {
                requestAnimationFrame(function () {
                    settleFrame(remaining - 1);
                });
            }
        }

        requestAnimationFrame(function () {
            settleFrame(frames);
        });
    }

    /**
     * While restoring a long conversation after refresh, messages, details and approval cards keep
     * growing across frames. Explicitly return to following when the restore starts; if the user
     * then scrolls up, the existing input listeners switch to detached immediately and the remaining
     * settle frames stop, so the reading position is never stolen back.
     */
    function settleConversationRestoreToBottom(frameCount?: number) {
        setScrollFollowing();
        const requestedFrames = Number.isFinite(Number(frameCount))
            ? Math.max(1, Math.floor(Number(frameCount)))
            : 30;
        const minimumDuration = Math.max(
            CONVERSATION_RESTORE_SETTLE_MIN_MS,
            Math.ceil(requestedFrames * (1000 / 60))
        );
        const generation = ++conversationRestoreGeneration;
        const startedAt = Date.now();
        let lastHeight = -1;
        let stableFrames = 0;

        function settleRestoreFrame() {
            if (generation !== conversationRestoreGeneration) return;
            // wheel / touch / keyboard / scrollbar drag switch to detached; respect the user's reading position immediately.
            if (scrollMode !== 'following' || Date.now() < detachLockUntil) return;
            const el = getChatMessagesEl();
            if (!el) return;

            scrollChatToBottomInstant();
            const currentHeight = el.scrollHeight;
            if (currentHeight === lastHeight && isNearBottom(1)) {
                stableFrames += 1;
            } else {
                stableFrames = 0;
            }
            lastHeight = currentHeight;

            const elapsed = Date.now() - startedAt;
            const reachedStableMinimum = elapsed >= minimumDuration
                && stableFrames >= CONVERSATION_RESTORE_STABLE_FRAMES;
            if (!reachedStableMinimum && elapsed < CONVERSATION_RESTORE_SETTLE_MAX_MS) {
                requestAnimationFrame(settleRestoreFrame);
            }
        }

        requestAnimationFrame(settleRestoreFrame);
    }

    /** @param {boolean} wasPinned whether the view should have been following before the DOM update (from captureScrollPinState) */
    function scrollChatMessagesToBottomIfPinned(wasPinned?: boolean) {
        scheduleChatScrollToBottomIfFollowing(wasPinned);
    }

    function forceScrollChatToBottom(smooth = false) {
        setScrollFollowing();
        cancelAnimationFrame(scrollFollowRaf);
        if (smooth) {
            scrollChatToBottomSmooth();
        } else {
            scrollChatToBottomInstant();
        }
    }

    function onUserSendMessage() {
        setScrollFollowing();
        scrollChatToBottomInstant();
    }

    function clearAllStreamingMarkers() {
        document.querySelectorAll('.progress-container.is-streaming, .process-details-container.is-streaming').forEach(function (el) {
            el.classList.remove('is-streaming');
        });
    }

    function markProgressStreaming(active: boolean, progressId?: string) {
        if (!active) {
            clearAllStreamingMarkers();
            return;
        }
        if (!progressId) return;
        const progressEl = document.getElementById(progressId);
        const container = progressEl && progressEl.querySelector('.progress-container');
        if (container) container.classList.add('is-streaming');
    }

    function markProcessDetailsStreaming(active: boolean, assistantDomId?: string | null) {
        if (!active) {
            document.querySelectorAll('.process-details-container.is-streaming').forEach(function (el) {
                el.classList.remove('is-streaming');
            });
            return;
        }
        if (!assistantDomId) return;
        const container = document.getElementById('process-details-' + assistantDomId);
        if (!container) return;
        container.classList.add('is-streaming');
        const timeline = container.querySelector('.progress-timeline');
        if (timeline) timeline.classList.add('expanded');
    }

    function onStreamEnd() {
        clearAllStreamingMarkers();
        try {
            deps.setReplayStream({ active: false, conversationId: null, assistantDomId: null, progressId: null });
        } catch { /* ignore */ }
        scheduleTurnRailRefresh(true);
        updateTurnRailState();
    }

    /** Align with the sendMessage main flow when the post-refresh task-events replay stream starts */
    function onTaskEventStreamBegin(conversationId: string, assistantDomId?: string | null, progressId?: string | null) {
        try {
            deps.setReplayStream({
                active: true,
                conversationId: conversationId || null,
                assistantDomId: assistantDomId || null,
                progressId: progressId || null
            });
        } catch { /* ignore */ }
        markProcessDetailsStreaming(true, assistantDomId);
        resumeFollowingIfAtBottom();
        scheduleTurnRailRefresh();
        updateTurnRailState();
    }

    function onTaskEventStreamEnd() {
        onStreamEnd();
    }

    function applyMessageScrollOption(options?: AddMessageOptions | null) {
        scheduleTurnRailRefresh();
        const opt = (options && options.scroll) || 'follow';
        if (opt === 'none') return;
        if (opt === 'force') {
            forceScrollChatToBottom(false);
            return;
        }
        scheduleChatScrollToBottomIfFollowing(captureScrollPinState());
    }

    /** Prevent scrollIntoView from stealing the scroll while streaming or while the user is not following */
    function scrollElementIntoViewIfFollowing(el: Element | null, options?: ScrollIntoViewOptions) {
        if (!el || !captureScrollPinState()) return;
        el.scrollIntoView(options || { behavior: 'smooth', block: 'nearest' });
    }

    function onChatMessagesScroll() {
        const el = getChatMessagesEl();
        if (!el) return;

        const st = el.scrollTop;
        const sh = el.scrollHeight;
        const hasUserScrollIntent = Date.now() <= userScrollIntentUntil;

        if (programmaticScroll) {
            // While scripted restore/stream stick-to-bottom runs, the user may still wheel or drag the
            // scrollbar the other way. Scripted scrolling only increases scrollTop, so a decrease here
            // means the user is interrupting following.
            if (st < lastScrollTop - 1 && (scrollMode === 'detached' || hasUserScrollIntent)) {
                setScrollDetached();
            }
            lastScrollTop = st;
            lastScrollHeight = sh;
            updateTurnRailState();
            return;
        }

        const scrolledUp = st < lastScrollTop - 1;
        const scrolledDown = st > lastScrollTop + 1;
        const contentShrank = sh < lastScrollHeight - 1;

        // Refresh/final-state re-renders clear or collapse the old DOM first and the browser passively
        // shrinks scrollTop. That is not a user scroll-up and must not exit following.
        if (contentShrank) {
            lastScrollTop = st;
            lastScrollHeight = sh;
            updateTurnRailState();
            return;
        }

        // Refresh restores rebuild messages and details; scroll anchoring may momentarily reduce
        // scrollTop without user input. Only an explicit wheel, touch, keyboard or scrollbar intent
        // detaches the sticky bottom.
        if (scrolledUp && (scrollMode === 'detached' || hasUserScrollIntent)) {
            setScrollDetached();
        } else if (
            scrolledDown &&
            hasUserScrollIntent &&
            resumeFollowingIfAtBottom(CHAT_SCROLL_FOLLOW_RESUME_THRESHOLD_PX, true)
        ) {
            // Resume following only on an explicit downward scroll that reaches the real bottom; do not
            // rewrite scrollTop here. New content then sticks naturally while following, avoiding jumps
            // when near the bottom.
        }

        lastScrollTop = st;
        lastScrollHeight = sh;
        updateTurnRailState();
    }

    function bindChatScrollListeners() {
        if (listenersBound) return;
        const el = getChatMessagesEl();
        if (!el) return;
        listenersBound = true;
        lastScrollTop = el.scrollTop;
        lastScrollHeight = el.scrollHeight;

        el.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaY) > 1) {
                userScrollIntentUntil = Date.now() + 1200;
            }
            if (e.deltaY < -1) {
                setScrollDetached();
            }
        }, { passive: true, signal: lifecycle.signal });

        // Dragging the native vertical scrollbar produces no wheel events; record pointer intent first, then let the scroll event confirm the direction.
        el.addEventListener('pointerdown', function (e) {
            const rect = el.getBoundingClientRect();
            if (e.clientX >= rect.right - 18) {
                userScrollIntentUntil = Date.now() + 1800;
            }
        }, { passive: true, signal: lifecycle.signal });

        el.addEventListener('keydown', function (e) {
            const scrollKeys = ['ArrowUp', 'PageUp', 'Home', 'ArrowDown', 'PageDown', 'End', ' '];
            if (scrollKeys.includes(e.key)) {
                userScrollIntentUntil = Date.now() + 1200;
            }
            if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey)) {
                setScrollDetached();
            }
        }, { signal: lifecycle.signal });

        el.addEventListener('touchmove', function (e) {
            if (e.touches && e.touches.length === 1) {
                userScrollIntentUntil = Date.now() + 1200;
                touchLastY = touchLastY != null ? touchLastY : e.touches[0]!.clientY;
                if (e.touches[0]!.clientY > touchLastY + 4) {
                    setScrollDetached();
                }
                touchLastY = e.touches[0]!.clientY;
            }
        }, { passive: true, signal: lifecycle.signal });
        el.addEventListener('touchstart', function (e) {
            if (e.touches && e.touches.length) {
                touchLastY = e.touches[0]!.clientY;
            }
        }, { passive: true, signal: lifecycle.signal });
        el.addEventListener('touchend', function () {
            touchLastY = null;
        }, { passive: true, signal: lifecycle.signal });

        el.addEventListener('scroll', onChatMessagesScroll, { passive: true, signal: lifecycle.signal });

        const returnLatestButton = getReturnLatestButton();
        if (returnLatestButton) {
            returnLatestButton.addEventListener('pointerdown', isolateReturnLatestPointerEvent, { signal: lifecycle.signal });
            returnLatestButton.addEventListener('pointerup', isolateReturnLatestPointerEvent, { signal: lifecycle.signal });
            returnLatestButton.addEventListener('click', onReturnLatestClick, { signal: lifecycle.signal });
        }

        const turnPreview = document.getElementById('chat-turn-rail-preview');
        if (turnPreview) {
            turnPreview.addEventListener('mouseenter', function () {
                if (turnPreviewHideTimer) {
                    clearTimeout(turnPreviewHideTimer);
                    turnPreviewHideTimer = 0;
                }
            }, { signal: lifecycle.signal });
            turnPreview.addEventListener('mouseleave', scheduleHideTurnPreview, { signal: lifecycle.signal });
        }

        if (typeof MutationObserver === 'function') {
            turnRailObserver = new MutationObserver(function () {
                scheduleTurnRailRefresh();
                // The final reply replaces the message bubble HTML and task details keep growing in the
                // subtree. Merge stick-to-bottom per frame only while following; a detached state after
                // the user scrolls up is left untouched.
                if (scrollMode === 'following' && Date.now() >= detachLockUntil) {
                    scheduleChatScrollToBottomIfFollowing(true);
                }
            });
            turnRailObserver.observe(el, { childList: true, subtree: true, characterData: true });
        }

        if (typeof ResizeObserver === 'function') {
            chatMessagesResizeObserver = new ResizeObserver(function () {
                // The running-task bar, composer or viewport changes can alter the message area
                // clientHeight without triggering the subtree MutationObserver. Re-settle precisely
                // while following.
                if (scrollMode === 'following' && Date.now() >= detachLockUntil) {
                    scheduleChatScrollToBottomIfFollowing(true);
                } else {
                    updateTurnRailState();
                }
            });
            chatMessagesResizeObserver.observe(el);
        }

        browser.addEventListener('resize', function () {
            hideTurnPreview();
            if (scrollMode === 'following' && Date.now() >= detachLockUntil) {
                scheduleChatScrollToBottomIfFollowing(true);
            } else {
                updateTurnRailState();
            }
        }, { passive: true, signal: lifecycle.signal });
    }

    function initChatScroll() {
        bindChatScrollListeners();
        const el = getChatMessagesEl();
        if (el) {
            lastScrollTop = el.scrollTop;
            lastScrollHeight = el.scrollHeight;
        }
        scheduleTurnRailRefresh(true);
        updateTurnRailState();
    }

    const api = {
        init: initChatScroll,
        onUserSendMessage: onUserSendMessage,
        onStreamEnd: onStreamEnd,
        onTaskEventStreamBegin: onTaskEventStreamBegin,
        onTaskEventStreamEnd: onTaskEventStreamEnd,
        captureScrollPinState: captureScrollPinState,
        scheduleScroll: scheduleChatScrollToBottomIfFollowing,
        scrollIfPinned: scrollChatMessagesToBottomIfPinned,
        settleToBottomIfFollowing: settleChatToBottomIfFollowing,
        settleConversationRestoreToBottom: settleConversationRestoreToBottom,
        forceScrollToBottom: forceScrollChatToBottom,
        applyMessageScroll: applyMessageScrollOption,
        scrollIntoViewIfFollowing: scrollElementIntoViewIfFollowing,
        isPinnedToBottom: isChatMessagesPinnedToBottom,
        markProgressStreaming: markProgressStreaming,
        markProcessDetailsStreaming: markProcessDetailsStreaming,
        setScrollFollowing: setScrollFollowing,
        setScrollDetached: setScrollDetached,
        refreshReturnLatest: updateReturnLatestButton,
        refreshTurnRail: function () { scheduleTurnRailRefresh(true); },
        isChatMessagesPinnedToBottom,
        scrollChatMessagesToBottomIfPinned,
        scrollElementIntoViewIfFollowing,
        destroy() {
            if (disposed) return;
            disposed = true;
            lifecycle.abort();
            scrollSettleGeneration++;
            conversationRestoreGeneration++;
            turnRailObserver?.disconnect();
            chatMessagesResizeObserver?.disconnect();
            frames.forEach(id => browser.cancelAnimationFrame(id));
            timers.forEach(id => browser.clearTimeout(id));
            frames.clear(); timers.clear();
            hideTurnPreview();
            clearAllStreamingMarkers();
        },
    };
    return api;
}
