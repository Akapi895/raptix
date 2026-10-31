import { escapeHtml } from '../../ui/format';
export type ToastKind = 'success' | 'error' | 'info' | 'warning';
/** Shared legacy notifications used to be declared in knowledge.js. The bridge keeps that entry point. */
export function createKnowledgeToast(doc: Document) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const nodes = new Set<HTMLElement>();
  let disposed = false;
  const later = (fn: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!disposed) fn(); }, ms); timers.add(timer); };
  return {
    show(message: string, kind: ToastKind = 'info'): void {
      if (disposed) return;
      if (!['success', 'error', 'info', 'warning'].includes(kind)) kind = 'info';
      let container = doc.getElementById('toast-notification-container');
      if (!container) { container = doc.createElement('div'); container.id = 'toast-notification-container'; container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10100;display:flex;flex-direction:column;gap:12px;pointer-events:none'; doc.body.appendChild(container); }
      if (!doc.getElementById('toast-notification-styles')) { const style = doc.createElement('style'); style.id = 'toast-notification-styles'; style.textContent = '@keyframes slideInRight{from{transform:translateX(16px);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(16px);opacity:0}}'; doc.head.appendChild(style); }
      const colors = { success: ['#f4fbf6', '#cce8d4', '#3d6654', '#52a06a'], error: ['#fef7f7', '#f3d0d0', '#8b4444', '#c96a6a'], info: ['#f5f9ff', '#cfe0f5', '#4a6078', '#6b8fbf'], warning: ['#fffbf3', '#f0dfc0', '#7a6535', '#c4a04a'] } as const;
      const paths = { success: '<circle cx="8" cy="8" r="7"/><path d="M5 8l2 2 4-4"/>', error: '<circle cx="8" cy="8" r="7"/><path d="M6 6l4 4M10 6l-4 4"/>', info: '<circle cx="8" cy="8" r="7"/><path d="M8 7v4M8 5.5v.01"/>', warning: '<path d="M8 2.5l6 10.5H2L8 2.5zM8 7v2.5M8 11v.01"/>' };
      const [background, border, color, iconColor] = colors[kind];
      const toast = doc.createElement('div'); toast.className = `toast-notification toast-${kind}`; toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      toast.style.cssText = `background:${background};border:1px solid ${border};color:${color};padding:10px 14px;border-radius:10px;box-shadow:0 2px 8px rgba(15,23,42,.06);min-width:220px;max-width:420px;pointer-events:auto;animation:slideInRight .25s ease-out;display:flex;align-items:center;gap:10px;font-size:.875rem;line-height:1.45;word-wrap:break-word;backdrop-filter:none;-webkit-backdrop-filter:none`;
      toast.innerHTML = `<span style="color:${iconColor};flex-shrink:0;display:flex;align-items:center"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg></span><span style="flex:1">${escapeHtml(message)}</span><button type="button" aria-label="Close" style="background:transparent;border:none;color:${color};cursor:pointer;font-size:1rem;padding:0;margin-left:4px;opacity:.45;flex-shrink:0;width:20px;height:20px;display:flex;align-items:center;justify-content:center">×</button>`;
      const close = toast.querySelector('button');
      const remove = () => { toast.remove(); nodes.delete(toast); };
      close?.addEventListener('click', remove); close?.addEventListener('mouseover', () => { close.style.opacity = '.75'; }); close?.addEventListener('mouseout', () => { close.style.opacity = '.45'; });
      container.appendChild(toast); nodes.add(toast);
      later(() => { if (toast.isConnected) { toast.style.animation = 'slideOutRight .3s ease-out'; later(remove, 300); } }, kind === 'success' ? 5000 : kind === 'error' ? 7000 : 4000);
    },
    dispose(): void { disposed = true; timers.forEach(clearTimeout); timers.clear(); nodes.forEach(node => node.remove()); nodes.clear(); },
  };
}
