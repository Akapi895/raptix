import type { MobileLifecycle } from './lifecycle';

export function createMobileGestures(life: MobileLifecycle, isMobile: () => boolean) {
  const drawers = new WeakSet<HTMLElement>(), panels = new WeakSet<HTMLElement>();
  const passive = { passive: true };
  function drawer(sidebar: HTMLElement | null, close: () => void) {
    if (!sidebar || drawers.has(sidebar)) return;
    drawers.add(sidebar);
    let x = 0, y = 0, tracking = false, dragging = false;
    const reset = () => { tracking = dragging = false; life.style(sidebar, 'transition', ''); life.style(sidebar, 'transform', ''); };
    life.on<TouchEvent>(sidebar, 'touchstart', event => {
      reset(); const touch = event.touches[0];
      if (!isMobile() || event.touches.length !== 1 || !touch) return;
      x = touch.clientX; y = touch.clientY; tracking = true;
    }, passive);
    life.on<TouchEvent>(sidebar, 'touchmove', event => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) { reset(); return; }
      const dx = touch.clientX - x, dy = touch.clientY - y;
      if (!dragging) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4 && dx < 0) dragging = true;
        else if (Math.abs(dy) > 12) { reset(); return; }
      }
      if (dragging && dx < 0) {
        life.style(sidebar, 'transition', 'none'); life.style(sidebar, 'transform', `translateX(${dx}px)`);
      }
    }, passive);
    life.on<TouchEvent>(sidebar, 'touchend', event => {
      if (!tracking) return;
      const dx = (event.changedTouches[0]?.clientX ?? x) - x, shouldClose = dragging && dx < -60;
      reset(); if (shouldClose) close();
    }, passive);
    life.on(sidebar, 'touchcancel', reset, passive);
  }
  function panel(panel: HTMLElement | null, close: () => void, kind: 'sheet' | 'selection') {
    if (!panel || panels.has(panel)) return;
    panels.add(panel);
    let y = 0, lastY = 0, tracking = false, dragging = false;
    const reset = () => { tracking = dragging = false; life.style(panel, 'transition', ''); life.style(panel, 'transform', ''); };
    life.on<TouchEvent>(panel, 'touchstart', event => {
      reset(); const touch = event.touches[0];
      if (!isMobile() || event.touches.length !== 1 || !touch) return;
      const target = event.target instanceof Element ? event.target : null;
      if (kind === 'sheet') {
        if ((target?.closest<HTMLElement>('.m-sheet-body')?.scrollTop ?? 0) > 0) return;
      } else {
        let node = target;
        while (node && node !== panel) {
          const overflow = getComputedStyle(node).overflowY;
          if ((overflow === 'auto' || overflow === 'scroll') && node.scrollTop > 0) return;
          node = node.parentElement;
        }
      }
      y = lastY = touch.clientY; tracking = true;
    }, passive);
    life.on<TouchEvent>(panel, 'touchmove', event => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) { reset(); return; }
      lastY = touch.clientY; const dy = lastY - y;
      if (!dragging && dy > 10) dragging = true;
      if (dragging && dy > 0) { life.style(panel, 'transition', 'none'); life.style(panel, 'transform', `translateY(${dy}px)`); }
    }, passive);
    life.on<TouchEvent>(panel, 'touchend', event => {
      if (!tracking) return;
      const dy = (event.changedTouches[0]?.clientY ?? lastY) - y, shouldClose = dragging && dy > 70;
      reset(); if (shouldClose) close();
    }, passive);
    life.on(panel, 'touchcancel', reset, passive);
  }
  function edge(doc: Document, blocked: () => boolean, open: () => void) {
    let x = 0, y = 0, armed = false, dragging = false;
    const reset = () => { armed = dragging = false; };
    life.on<TouchEvent>(doc, 'touchstart', event => {
      reset(); const touch = event.touches[0];
      if (!isMobile() || event.touches.length !== 1 || !touch || blocked() || touch.clientX > 24) return;
      x = touch.clientX; y = touch.clientY; armed = true;
    }, passive);
    life.on<TouchEvent>(doc, 'touchmove', event => {
      const touch = event.touches[0];
      if (!armed || event.touches.length !== 1 || !touch) { reset(); return; }
      const dx = touch.clientX - x, dy = touch.clientY - y;
      if (!dragging) {
        if (dx > 18 && Math.abs(dx) > Math.abs(dy) * 1.4) { dragging = true; open(); }
        else if (Math.abs(dy) > 16) armed = false;
      }
    }, passive);
    life.on(doc, 'touchend', reset, passive); life.on(doc, 'touchcancel', reset, passive);
  }
  return { drawer, panel, edge };
}
