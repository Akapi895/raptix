import type { ProjectsDom } from './dom';
import type { Approval } from './types';
import { getProjectApprovalTiming } from './folder-service';

export function createProjectApprovalBadges(dom: ProjectsDom) {
  const entries = new Set<{ element: HTMLElement; update(): boolean }>();
  let timer: ReturnType<typeof setInterval> | undefined;
  function tick() { for (const entry of entries) if (!entry.element.isConnected || !entry.update()) entries.delete(entry); if (!entries.size) { clearInterval(timer); timer = undefined; } }
  function append(container: HTMLElement, kinds: string[], details?: Approval, aggregateCount?: number) {
    if (!kinds.length) return;
    const group = dom.document.createElement('span'); group.className = 'project-task-status-group' + (aggregateCount !== undefined ? ' project-task-status-group--folder' : '');
    for (const kind of new Set(kinds)) {
      const element = dom.document.createElement('span'); element.className = `project-task-status project-task-status--${kind}`;
      const label = aggregateCount !== undefined && kind === 'approval' ? dom.fmt('hitl.waitingApprovalCount', `${aggregateCount} awaiting approval`, { count: aggregateCount }) : dom.t(kind === 'approval' ? 'hitl.waitingApprovalShort' : kind === 'running' ? 'tasks.statusRunning' : 'chat.completedUnread');
      element.title = label; element.setAttribute('aria-label', label);
      if (kind !== 'approval') element.textContent = label;
      else {
        const timing = getProjectApprovalTiming(details);
        element.innerHTML = '<span class="project-approval-label"></span>' + (aggregateCount === undefined && timing.timeoutSeconds && timing.expiresAt ? '<span class="project-approval-time"></span><span class="project-approval-progress"><span class="project-approval-progress-value"></span></span>' : '');
        const labelElement = element.querySelector('.project-approval-label'); if (labelElement) labelElement.textContent = label;
        if (aggregateCount !== undefined) { element.classList.add('project-task-status--approval-summary', 'is-urgency-normal'); element.dataset.approvalCount = String(aggregateCount); element.dataset.approvalUrgency = 'normal'; }
        else {
          const update = () => {
            const remaining = Math.max(0, timing.expiresAt - Date.now());
            const level = !timing.timeoutSeconds || !timing.expiresAt ? 'normal' : remaining <= 60000 ? 'critical' : remaining <= 180000 ? 'warning' : 'normal';
            const urgency = dom.t(!timing.expiresAt || !timing.timeoutSeconds ? 'hitl.approvalUrgencyUnlimited' : level === 'critical' ? 'hitl.approvalUrgencyWithinOne' : level === 'warning' ? 'hitl.approvalUrgencyOneToThree' : 'hitl.approvalUrgencyMoreThanThree');
            element.classList.remove('is-urgency-normal', 'is-urgency-warning', 'is-urgency-urgent', 'is-urgency-critical'); element.classList.add(`is-urgency-${level}`); element.dataset.approvalUrgency = level; element.setAttribute('aria-label', `${label}, ${urgency}`); element.title = `${label} · ${urgency}`;
            if (timing.timeoutSeconds && timing.expiresAt) {
              const seconds = Math.ceil(remaining / 1000), percent = Math.max(0, Math.min(100, remaining / (timing.timeoutSeconds * 1000) * 100));
              const time = element.querySelector('.project-approval-time'), value = element.querySelector<HTMLElement>('.project-approval-progress-value');
              if (time) time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; if (value) value.style.width = `${percent.toFixed(2)}%`;
              element.setAttribute('role', 'progressbar'); element.setAttribute('aria-valuemin', '0'); element.setAttribute('aria-valuemax', '100'); element.setAttribute('aria-valuenow', String(Math.round(percent))); element.classList.toggle('is-expired', remaining <= 0);
            }
            return !(timing.expiresAt && remaining <= 0);
          };
          if (update() && timing.timeoutSeconds && timing.expiresAt) { entries.add({ element, update }); timer ??= setInterval(tick, 1000); }
        }
      }
      group.append(element);
    }
    container.append(group);
  }
  return { append, dispose() { clearInterval(timer); entries.clear(); } };
}
