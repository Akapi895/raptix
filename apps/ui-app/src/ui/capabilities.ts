import { escapeHtml } from './format';
import { openAppModal, type ModalOptions } from './modal';

const keyboardBound = new WeakSet<Document>();

/** Scope keyboard improvements to capability editors; preserve each feature's close action. */
export function openCapabilityModal(modal: HTMLElement | null | undefined, options: ModalOptions = {}): HTMLElement | null {
  if (!modal) return null;
  const close = modal.querySelector<HTMLElement>('.modal-close');
  if (close && !(close instanceof HTMLButtonElement)) {
    const button = modal.ownerDocument.createElement('button');
    for (const attribute of close.attributes) button.setAttribute(attribute.name, attribute.value);
    button.type = 'button'; button.setAttribute('aria-label', 'Close dialog'); button.textContent = close.textContent;
    close.replaceWith(button);
  }
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
  const title = modal.querySelector('h2');
  if (title) { title.id ||= `${modal.id}-heading`; modal.setAttribute('aria-labelledby', title.id); }
  const doc = modal.ownerDocument;
  if (!keyboardBound.has(doc)) {
    keyboardBound.add(doc);
    doc.addEventListener('keydown', event => {
      const active = [...doc.querySelectorAll<HTMLElement>('.capabilities-modal[role="dialog"]')].filter(node => node.getClientRects().length > 0).at(-1);
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); active.querySelector<HTMLButtonElement>('.modal-close')?.click(); }
      if (event.key !== 'Tab') return;
      const elements = [...active.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex="0"]')].filter(node => !node.matches(':disabled,[aria-hidden="true"]') && node.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (!active.contains(doc.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && doc.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && doc.activeElement === last && first) { event.preventDefault(); first.focus(); }
    }, true);
  }
  const opened = openAppModal(modal, options);
  // Enter the dialog synchronously; the shared helper focuses the first field next frame.
  // Escape must also work between opening and that animation frame, or while fields load.
  modal.querySelector<HTMLElement>('.modal-close')?.focus();
  requestAnimationFrame(() => { const body = modal.querySelector('.modal-body'); if (body) body.scrollTop = 0; });
  return opened;
}

/** Presentation shared only by the Capabilities inventories. Rows remain feature-owned. */
export function capabilityTable(label: string, columns: string[], rows: string, grouped = false): string {
  return `<div class="cap-table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(label)}"><table class="cap-table"><caption class="cap-sr-only">${escapeHtml(label)}</caption><thead><tr>${columns.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead>${grouped ? rows : `<tbody>${rows}</tbody>`}</table></div>`;
}

export function capabilityState(title: string, hint = '', action = '', error = false): string {
  return `<div class="cap-state${error ? ' cap-state-error' : ''}" role="${error ? 'alert' : 'status'}"><strong>${escapeHtml(title)}</strong>${hint ? `<p>${escapeHtml(hint)}</p>` : ''}${action}</div>`;
}
