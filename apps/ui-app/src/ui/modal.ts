const overlays = '.projects-modal-overlay, .c2-modal-overlay, .modal, .info-collect-cell-modal, #login-overlay';
const flexIds = new Set(['role-modal', 'skill-modal', 'agent-md-modal', 'batch-manage-modal', 'workflow-meta-modal', 'workflow-dry-run-modal', 'login-overlay']);
type ModalTarget = string | HTMLElement | null | undefined;
export interface ModalOptions { display?: string; focus?: boolean; focusSelector?: string; focusEl?: HTMLElement | null }
const previousFocus = new WeakMap<HTMLElement, HTMLElement>();
function resolve(target: ModalTarget): HTMLElement | null { return typeof target === 'string' ? document.getElementById(target) : target ?? null; }
function visible(element: HTMLElement | null): boolean {
  if (!element) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}
export function syncAppModalBodyLock(): void {
  document.body.classList.toggle('app-modal-open', [...document.querySelectorAll<HTMLElement>(overlays)].some(visible));
  document.body.classList.toggle('projects-modal-open', [...document.querySelectorAll<HTMLElement>('.projects-modal-overlay')].some(visible));
}
export function openAppModal(target: ModalTarget, options: ModalOptions = {}): HTMLElement | null {
  const element = resolve(target); if (!element) return null;
  if (!visible(element) && document.activeElement instanceof HTMLElement) previousFocus.set(element, document.activeElement);
  element.style.display = options.display || (flexIds.has(element.id) || element.matches('.projects-modal-overlay,.c2-modal-overlay,.info-collect-cell-modal,.chat-files-form-modal') ? 'flex' : 'block');
  syncAppModalBodyLock();
  if (options.focus !== false) {
    const focus = options.focusEl || element.querySelector<HTMLElement>(options.focusSelector || 'input.form-input,textarea.form-input,select.form-input,input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled])');
    if (focus) requestAnimationFrame(() => { if (visible(element) && focus.isConnected) focus.focus(); });
  }
  return element;
}
export function closeAppModal(target: ModalTarget): HTMLElement | null {
  const element = resolve(target);
  if (element) {
    const restore = previousFocus.get(element);
    const contained = element.contains(document.activeElement);
    element.style.display = 'none'; previousFocus.delete(element);
    if (contained && restore?.isConnected) restore.focus({ preventScroll: true });
  }
  syncAppModalBodyLock(); return element;
}
export function isAppModalOpen(target: ModalTarget): boolean { return visible(resolve(target)); }
export function deferModalContent(callback: () => void): void { requestAnimationFrame(() => requestAnimationFrame(callback)); }
