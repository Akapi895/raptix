import type { deriveProgress } from './plan-progress';
import type { Translate } from './types';

export function createPlanProgressView(document: Document, t: Translate | undefined, toggle: () => void) {
    const host = document.getElementById('agent-plan-progress');
    const lifecycle = new AbortController();
    let passiveHoverAnchor: { x: number; y: number } | null = null;
    function clearPassiveHoverVisual() { host?.classList.remove('is-hover-active'); }
    function resetPassiveHover() { clearPassiveHoverVisual(); passiveHoverAnchor = null; }
    function disarmPassiveHover(event: MouseEvent) {
        clearPassiveHoverVisual();
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        passiveHoverAnchor = { x: event.clientX, y: event.clientY };
    }
    function armHoverAfterPointerMove(event: PointerEvent) {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        if (passiveHoverAnchor) {
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
            if (event.clientX === passiveHoverAnchor.x && event.clientY === passiveHoverAnchor.y) return;
            passiveHoverAnchor = null;
        }
        host?.classList.add('is-hover-active');
    }
    function translate(key: string, fallback: string, params: Record<string, unknown> = {}) {
        const translated = t?.(key, params);
        if (translated && translated !== key) return translated;
        let value = fallback;
        Object.entries(params).forEach(([name, replacement]) => { value = value.replaceAll('{{' + name + '}}', String(replacement)); });
        return value;
    }
    function statusIcon(status: string) {
        const icon = document.createElement('span');
        icon.className = 'agent-plan-task-status agent-plan-task-status--' + status;
        icon.setAttribute('aria-hidden', 'true');
        if (status === 'completed') {
            const namespace = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(namespace, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
            svg.classList.add('agent-plan-task-check');
            const path = document.createElementNS(namespace, 'path');
            path.setAttribute('d', 'M7.5 12.5 10.5 15.5 16.8 8.8'); svg.appendChild(path); icon.appendChild(svg);
        }
        return icon;
    }
    return {
        present: !!host, resetPassiveHover,
        contains: (target: EventTarget | null) => target instanceof Node && !!host?.contains(target),
        activate() {
            const options = { signal: lifecycle.signal };
            host?.addEventListener('pointermove', armHoverAfterPointerMove, options);
            host?.addEventListener('pointerleave', clearPassiveHoverVisual, options);
            const latest = document.getElementById('chat-return-latest');
            latest?.addEventListener('pointerdown', disarmPassiveHover, options);
            latest?.addEventListener('click', disarmPassiveHover, options);
        },
        render(progress: ReturnType<typeof deriveProgress>, expanded: boolean) {
            if (!host) return;
            host.replaceChildren();
            if (!progress.total) { host.hidden = true; resetPassiveHover(); return; }
            host.hidden = false; host.classList.toggle('is-open', expanded);
            const panel = document.createElement('div'); panel.className = 'agent-plan-progress-panel'; panel.id = 'agent-plan-progress-panel';
            panel.setAttribute('role', 'status'); panel.setAttribute('aria-label', translate('chat.taskProgressDetails', 'Task progress details'));
            progress.tasks.forEach(task => {
                const row = document.createElement('div'); row.className = 'agent-plan-task agent-plan-task--' + task.status;
                row.appendChild(statusIcon(task.status));
                const label = document.createElement('span'); label.className = 'agent-plan-task-label';
                label.textContent = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject || translate('chat.taskProgressUnnamed', 'Untitled task');
                if (task.description) label.title = task.description;
                row.appendChild(label); panel.appendChild(row);
            });
            const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'agent-plan-progress-trigger';
            trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', String(expanded));
            trigger.setAttribute('aria-label', translate('chat.taskProgressOpen', 'View task progress'));
            trigger.appendChild(statusIcon(progress.allCompleted ? 'completed' : 'in_progress'));
            const count = document.createElement('span'); count.className = 'agent-plan-progress-count';
            count.textContent = translate('chat.taskProgressStep', 'Step {{current}} of {{total}}', { current: progress.activeStep, total: progress.total });
            trigger.appendChild(count); trigger.addEventListener('click', toggle);
            host.append(panel, trigger);
        },
        dispose() { lifecycle.abort(); resetPassiveHover(); host?.replaceChildren(); if (host) host.hidden = true; },
    };
}
