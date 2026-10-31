// Layout of the session settings popover over the composer: where it is mounted, whether the composer
// reports itself as open, and how tall the composer is so the chat column can reserve room for it.

export interface SessionLayout {
  /** Moves the settings card into the composer surface and marks it as a popover. */
  mountPopover(): void;
  /** Mirrors whether the settings card is open onto the composer. */
  syncLayerState(): void;
  /** Publishes the composer height to the chat container. */
  syncBarHeight(): void;
  /** Mounts, syncs once, and follows resizes of the window and the composer. */
  init(): () => void;
}

export function createSessionLayout(doc: Document, win: EventTarget): SessionLayout {
  const byId = (id: string) => doc.getElementById(id);

  function syncLayerState(): void {
    const wrap = byId('chat-reasoning-wrapper');
    const inputBar = byId('chat-input-container');
    if (!inputBar) return;
    const open = !!wrap && wrap.style.display !== 'none' && !wrap.classList.contains('conversation-reasoning-collapsed');
    inputBar.classList.toggle('is-session-settings-open', open);
    const shortcut = byId('chat-hitl-shortcut');
    shortcut?.setAttribute('aria-expanded', String(open));
    shortcut?.setAttribute('aria-controls', 'chat-reasoning-wrapper');
  }

  function mountPopover(): void {
    const wrap = byId('chat-reasoning-wrapper');
    const surface = doc.querySelector('.chat-composer-surface');
    if (!wrap || !surface) return;
    if (wrap.parentElement !== surface) surface.appendChild(wrap);
    wrap.classList.add('chat-session-settings-popover');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-labelledby', 'conversation-reasoning-toggle');
    syncLayerState();
  }

  function syncBarHeight(): void {
    const reasoning = byId('chat-reasoning-wrapper');
    const inputBar = byId('chat-input-container');
    if (!reasoning || !inputBar) return;
    // The composer is a two-layer surface and intentionally taller than the sidebar trigger; the settings card
    // must not mirror its height.
    reasoning.style.removeProperty('--chat-input-bar-height');
    const container = inputBar.closest<HTMLElement>('.chat-container');
    const height = Math.ceil(inputBar.getBoundingClientRect().height || 0);
    if (container && height > 0) {
      container.style.setProperty('--chat-composer-total-height', `${height}px`);
      const toolbarHeight = container.querySelector('.chat-taskbar')?.getBoundingClientRect().height || 0;
      const available = container.getBoundingClientRect().height - height - toolbarHeight - 24;
      container.style.setProperty('--chat-popover-max-height', `${Math.max(100, Math.floor(available))}px`);
    }
  }

  return {
    mountPopover,
    syncLayerState,
    syncBarHeight,
    init(): () => void {
      mountPopover();
      syncBarHeight();
      const onResize = () => syncBarHeight();
      win.addEventListener('resize', onResize);
      const inputBar = byId('chat-input-container');
      const observer = inputBar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      if (inputBar && observer) observer.observe(inputBar);
      return () => {
        win.removeEventListener('resize', onResize);
        observer?.disconnect();
      };
    },
  };
}
