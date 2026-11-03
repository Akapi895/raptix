// Shared hover/focus tooltip for elements carrying data-selection-detail. Used by the role
// and project pickers and the webshell list; installed once at startup by main.ts.
import { browser } from '@/platform/browser';

export interface TooltipViewport {
  viewport(): { width: number; height: number };
  on(type: string, listener: EventListener, capture?: boolean): () => void;
}

export function installSelectionTooltip(doc: Document = document, viewport: TooltipViewport = browser): () => void {
  const tooltip = doc.createElement('div');
  tooltip.className = 'selection-detail-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  doc.body.appendChild(tooltip);

  let active: HTMLElement | null = null;
  const detailOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('[data-selection-detail]') : null;

  function hide(): void {
    active = null;
    tooltip.classList.remove('visible', 'placement-left');
  }

  function show(el: HTMLElement): void {
    const text = el.getAttribute('data-selection-detail');
    if (!text) { hide(); return; }
    active = el;
    tooltip.textContent = text;
    tooltip.classList.add('visible');

    const rect = el.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const gap = 12;
    const margin = 12;
    const size = viewport.viewport();
    const rightSpace = size.width - rect.right - gap - margin;
    const placeLeft = rightSpace < tip.width && rect.left > tip.width + gap + margin;
    const left = placeLeft ? rect.left - tip.width - gap : rect.right + gap;
    const top = Math.max(margin, Math.min(rect.top + rect.height / 2 - tip.height / 2, size.height - tip.height - margin));

    tooltip.classList.toggle('placement-left', placeLeft);
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  // Leaving between a target and its own descendants does not count as leaving the target.
  const onOver = (event: MouseEvent) => {
    const el = detailOf(event.target);
    if (!el || (event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) return;
    show(el);
  };
  const onOut = (event: MouseEvent) => {
    const el = detailOf(event.target);
    if (!el || (event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) return;
    hide();
  };
  const onFocusIn = (event: FocusEvent) => { const el = detailOf(event.target); if (el) show(el); };
  const onFocusOut = (event: FocusEvent) => { if (detailOf(event.target)) hide(); };
  const onResize = () => { if (active) show(active); };

  doc.addEventListener('mouseover', onOver);
  doc.addEventListener('mouseout', onOut);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('focusout', onFocusOut);
  const stopScroll = viewport.on('scroll', hide, true);
  const stopResize = viewport.on('resize', onResize);

  return () => {
    doc.removeEventListener('mouseover', onOver);
    doc.removeEventListener('mouseout', onOut);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', onFocusOut);
    stopScroll();
    stopResize();
    tooltip.remove();
  };
}
