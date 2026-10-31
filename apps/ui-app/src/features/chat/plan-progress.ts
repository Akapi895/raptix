import { record } from './stream';
import { createPlanProgressView } from './plan-progress-view';
import type { Translate } from './types';

export interface PlanTask { id: string; subject: string; description: string; activeForm: string; status: string }
export interface PlanDependencies {
    request(url: string, init?: RequestInit): Promise<Response>;
    conversationId(): string | null | undefined;
    isTaskRunning(id: string): boolean;
    translate?: Translate;
}

    const PLAN_TOOL_NAMES = new Set(['taskcreate', 'taskupdate', 'tasklist', 'taskget']);
    const ACTIVE_POLL_INTERVAL_MS = 1500;
    const ERROR_RETRY_INTERVAL_MS = 4000;
    const FINAL_STATE_HOLD_MS = 2400;

    export function normalizeTask(raw: unknown, index: number): PlanTask {
        const task = record(raw);
        const status = String(task.status || 'pending').trim().toLowerCase();
        return {
            id: String(task.id || (index + 1)),
            subject: String(task.subject || '').trim(),
            description: String(task.description || '').trim(),
            activeForm: String(task.activeForm || '').trim(),
            status: ['pending', 'in_progress', 'completed', 'deleted'].includes(status) ? status : 'pending'
        };
    }

    export function deriveProgress(rawTasks: unknown) {
        const tasks = (Array.isArray(rawTasks) ? rawTasks : [])
            .map(normalizeTask)
            .filter((task) => task.status !== 'deleted');
        let activeIndex = tasks.findIndex((task) => task.status === 'in_progress');
        if (activeIndex < 0) activeIndex = tasks.findIndex((task) => task.status !== 'completed');
        if (activeIndex < 0 && tasks.length) activeIndex = tasks.length - 1;
        return {
            tasks,
            total: tasks.length,
            completed: tasks.filter((task) => task.status === 'completed').length,
            activeStep: activeIndex >= 0 ? activeIndex + 1 : 0,
            allCompleted: tasks.length > 0 && tasks.every((task) => task.status === 'completed')
        };
    }

    export function applyTaskUpdate(rawTasks: unknown, args: unknown): PlanTask[] {
        const update = record(args);
        const taskID = String(update.taskId || update.taskID || '').trim();
        if (!taskID) return deriveProgress(rawTasks).tasks;
        return deriveProgress(rawTasks).tasks
            .filter((task) => !(String(update.status || '').toLowerCase() === 'deleted' && task.id === taskID))
            .map((task) => {
                if (task.id !== taskID) return task;
                return Object.assign({}, task, {
                    subject: String(update.subject || task.subject).trim(),
                    description: String(update.description || task.description).trim(),
                    activeForm: String(update.activeForm || task.activeForm).trim(),
                    status: String(update.status || task.status).trim().toLowerCase()
                });
            });
    }

export function createPlanProgress(document: Document, deps: PlanDependencies) {
    const root = document.defaultView!;
    const lifecycle = new AbortController();
    let disposed = false;
    const state = {
        conversationId: '',
        tasks: [] as PlanTask[],
        signature: '',
        expanded: false,
        requestSequence: 0,
        abortController: null as AbortController | null,
        refreshTimer: undefined as number | undefined,
        finalHoldUntil: 0,
        taskCalls: new Map<string, { toolName: string; args: unknown }>()
    };

    const view = createPlanProgressView(document, deps.translate, () => {
        state.expanded = !state.expanded;
        render(true);
        if (state.expanded) document.querySelector<HTMLElement>('.agent-plan-progress-trigger')?.focus();
    });
    function render(force: boolean) {
        const progress = deriveProgress(state.tasks);
        const signature = JSON.stringify(progress.tasks) + '|' + state.expanded;
        if (!force && signature === state.signature) return;
        state.signature = signature;
        view.render(progress, state.expanded);
    }

    function currentConversationId() {
        return String(deps.conversationId() || '').trim();
    }

    function isCurrentConversationRunning() {
        const conversationId = currentConversationId();
        if (!conversationId) return false;
        try {
            return deps.isTaskRunning(conversationId);
        } catch {
            return false;
        }
    }

    function shouldContinuePolling(payload: Record<string, unknown> | null) {
        if (!currentConversationId() || root.document.hidden) return false;
        if (payload && payload.running === false) return false;
        if (payload && payload.running === true) {
            return state.tasks.length > 0 || Date.now() < state.finalHoldUntil;
        }
        return isCurrentConversationRunning() && state.tasks.length > 0;
    }

    function setConversation(conversationId: unknown) {
        const next = String(conversationId || '').trim();
        if (next === state.conversationId) return false;
        state.conversationId = next;
        state.tasks = [];
        state.signature = '';
        state.expanded = false;
        state.finalHoldUntil = 0;
        state.taskCalls.clear();
        view.resetPassiveHover();
        state.requestSequence += 1;
        if (state.abortController) state.abortController.abort();
        state.abortController = null;
        render(true);
        return true;
    }

    async function fetchPlanTasks() {
        if (disposed || !view.present) return;
        const conversationId = currentConversationId();
        setConversation(conversationId);
        if (!conversationId || root.document.hidden) return;
        const sequence = ++state.requestSequence;
        if (state.abortController) state.abortController.abort();
        const controller = new AbortController();
        state.abortController = controller;
        let payload: Record<string, unknown> | null = null;
        let retryAfterError = false;
        try {
            const response = await deps.request('/api/conversations/' + encodeURIComponent(conversationId) + '/plan-tasks', {
                signal: controller.signal
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            payload = record(await response.json());
            if (sequence !== state.requestSequence || conversationId !== state.conversationId) return;
            if (payload && payload.running === false) {
                state.tasks = [];
                state.expanded = false;
                state.finalHoldUntil = 0;
                render(false);
                return;
            }
            const tasks = deriveProgress(payload && payload.tasks).tasks;
            if (!tasks.length && state.tasks.length && Date.now() < state.finalHoldUntil) return;
            state.tasks = tasks;
            render(false);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;
            retryAfterError = true;
            // A task list is supplemental UI; a transient poll failure must not
            // interfere with the chat or erase the last known task state.
        } finally {
            if (!disposed && sequence === state.requestSequence) {
                state.abortController = null;
                if (shouldContinuePolling(payload)) {
                    scheduleRefresh(retryAfterError ? ERROR_RETRY_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS);
                }
            }
        }
    }

    function scheduleRefresh(delay: number) {
        if (disposed) return;
        root.clearTimeout(state.refreshTimer);
        state.refreshTimer = root.setTimeout(fetchPlanTasks, Number(delay) || 0);
    }

    function handlePlanToolEvent(event: Event) {
        const detail = record(event instanceof CustomEvent ? event.detail : undefined);
        const conversationId = String(detail.conversationId || '').trim();
        if (!conversationId || conversationId !== currentConversationId()) return;
        const data = record(detail.data);
        const toolName = String(data.toolName || '').trim().toLowerCase();
        if (!PLAN_TOOL_NAMES.has(toolName)) return;
        const callId = String(data.toolCallId || '').trim();
        if (detail.eventType === 'tool_call') {
            if (callId) state.taskCalls.set(callId, { toolName, args: data.argumentsObj || {} });
            scheduleRefresh(60);
            return;
        }
        if (detail.eventType !== 'tool_result') return;
        const call = callId ? state.taskCalls.get(callId) : null;
        if (callId) state.taskCalls.delete(callId);
        if (data.success !== false && call && call.toolName === 'taskupdate') {
            state.tasks = applyTaskUpdate(state.tasks, call.args);
            const progress = deriveProgress(state.tasks);
            if (progress.allCompleted) state.finalHoldUntil = Date.now() + FINAL_STATE_HOLD_MS;
            render(false);
        }
        scheduleRefresh(100);
    }

    function handleConversationTaskStateChanged(event: Event) {
        const detail = record(event instanceof CustomEvent ? event.detail : undefined);
        const conversationId = String(detail.conversationId || '').trim();
        const currentId = currentConversationId();
        if (conversationId && conversationId !== currentId) return;
        if (isCurrentConversationRunning() || state.tasks.length) {
            scheduleRefresh(0);
        }
    }

    function activate() {
    if (disposed || !view.present) return;
    view.activate();
    root.addEventListener('agent-plan-task-event', handlePlanToolEvent, { signal: lifecycle.signal });
    root.addEventListener('conversation-task-state-changed', handleConversationTaskStateChanged, { signal: lifecycle.signal });
    root.addEventListener('conversation-changed', (event) => {
        setConversation(event instanceof CustomEvent ? record(event.detail).conversationId : currentConversationId());
        scheduleRefresh(0);
    }, { signal: lifecycle.signal });
    root.document.addEventListener('visibilitychange', () => {
        if (!root.document.hidden && (isCurrentConversationRunning() || state.tasks.length)) scheduleRefresh(0);
    }, { signal: lifecycle.signal });
    root.document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !state.expanded) return;
        state.expanded = false;
        render(true);
    }, { signal: lifecycle.signal });
    root.document.addEventListener('pointerdown', (event) => {
        if (!state.expanded || view.contains(event.target)) return;
        state.expanded = false;
        render(true);
    }, { signal: lifecycle.signal });

    setConversation(currentConversationId());
    void fetchPlanTasks();
    }
    return {
        activate, refresh: fetchPlanTasks, setConversation,
        getState: () => ({ conversationId: state.conversationId, tasks: state.tasks.map(task => ({ ...task })), expanded: state.expanded, finalHoldUntil: state.finalHoldUntil }),
        dispose() {
            if (disposed) return;
            disposed = true; lifecycle.abort(); state.requestSequence++;
            state.abortController?.abort(); root.clearTimeout(state.refreshTimer);
            state.taskCalls.clear(); view.dispose();
        },
    };
}
