/**
 * A short notice that does not block the chat: it fades in, stays for a moment and removes itself. Errors stay longer. The
 * styles are shared with the chat files toast.
 */
export function showChatToast(doc: Document, message: unknown, type?: string): void {
  const text = message == null ? '' : String(message);
  if (!text) return;
  const el = doc.createElement('div');
  el.className = 'chat-files-toast' + (type === 'error' ? ' chat-toast--error' : '');
  el.setAttribute('role', 'status');
  el.textContent = text;
  doc.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('chat-files-toast-visible'));
  const hideMs = type === 'error' ? 4500 : 2600;
  setTimeout(() => {
    el.classList.remove('chat-files-toast-visible');
    setTimeout(() => el.remove(), 300);
  }, hideMs);
}
