export type RouterAction = { kind: 'navigate' | 'submenu'; value: string } | { kind: 'sidebar' | 'conversation-sidebar' };

/** Read a structured action; markup never contains executable handler source. */
export function routerAction(kind: string, value: string): RouterAction | null {
  if (kind === 'navigate' || kind === 'submenu') return /^[a-z0-9-]+$/.test(value) ? { kind, value } : null;
  if (kind === 'sidebar' || kind === 'conversation-sidebar') return { kind };
  return null;
}
interface RouterActions {
  navigate(page: string): void;
  toggleSubmenu(menu: string): void;
  toggleSidebar(): void;
  toggleConversationSidebar(): void;
}
export function bindRouterActions(root: Document, actions: RouterActions): () => void {
  const dispatch = (event: Event) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>('[data-router-action],[data-action^="shell."]');
    if (!element || element.closest('[hidden],:disabled,[aria-disabled="true"]')) return;
    if (event instanceof KeyboardEvent && (element.dataset.routerKeyboard !== 'true' || !['Enter', ' '].includes(event.key))) return;
    const kind = element.dataset.routerAction ?? element.dataset.action?.replace('shell.', '');
    const value = element.dataset.routerValue ?? element.dataset.page ?? element.dataset.menu ?? '';
    const action = routerAction(kind ?? '', value);
    switch (action?.kind) {
      case 'navigate': event.preventDefault(); actions.navigate(action.value); break;
      case 'submenu': event.preventDefault(); actions.toggleSubmenu(action.value); break;
      case 'sidebar': event.preventDefault(); actions.toggleSidebar(); break;
      case 'conversation-sidebar': event.preventDefault(); actions.toggleConversationSidebar(); break;
    }
  };
  for (const type of ['click', 'keydown']) root.addEventListener(type, dispatch);
  return () => { for (const type of ['click', 'keydown']) root.removeEventListener(type, dispatch); };
}
