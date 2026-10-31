export function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', content = ''): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag); element.className = className; element.textContent = content; return element;
}
export function button(doc: Document, className: string, label: string, click: (event: MouseEvent) => void): HTMLButtonElement {
  const element = node(doc, 'button', className, label); element.type = 'button'; element.addEventListener('click', click); return element;
}
export function inputValue(doc: Document, id: string, value?: string): string {
  const input = doc.getElementById(id);
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) return '';
  if (value !== undefined) input.value = value;
  return input.value;
}
export function setText(doc: Document, id: string, value: string): void { const element = doc.getElementById(id); if (element) element.textContent = value; }
export function visible(doc: Document, id: string, show: boolean): void {
  const element = doc.getElementById(id); if (element) { element.hidden = !show; element.style.display = show ? '' : 'none'; }
}
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
/** Bind feature-owned declarative event names in static markup. */
export function bindStaticActions(doc: Document, actions: Record<string, (event: Event, element: HTMLElement) => void>): () => void {
  const cleanup: (() => void)[] = [];
  for (const element of doc.querySelectorAll<HTMLElement>('[data-chat-click],[data-chat-change],[data-chat-input],[data-chat-keydown],[data-chat-mouseenter],[data-chat-mouseleave],[data-chat-contextmenu]')) {
    for (const attribute of Array.from(element.attributes)) {
      if (!attribute.name.startsWith('data-chat-')) continue;
      const handler = actions[attribute.value];
      if (!handler) continue;
      const eventType = attribute.name.slice('data-chat-'.length);
      const listener = (event: Event) => handler(event, element);
      element.addEventListener(eventType, listener);
      cleanup.push(() => element.removeEventListener(eventType, listener));
    }
  }
  return () => cleanup.forEach(dispose => dispose());
}
