import { createMessageView } from '../messages/view';
import { formatMarkdownToHtml, stripSuspiciousImages } from '../../../ui/markdown';
import type { ChildTranscriptEntry } from './execution';

export function createAgentConversationOverlay(doc: Document) {
  let overlay: HTMLElement | null = null;
  let signature = '';
  let visible = false;

  function ensure(): HTMLElement | null {
    if (overlay?.isConnected) return overlay;
    const anchor = doc.getElementById('chat-messages');
    if (!anchor?.parentElement) return null;
    overlay = doc.createElement('section');
    overlay.id = 'csai-subagent-conversation';
    overlay.className = 'chat-messages csai-subagent-conversation';
    overlay.hidden = true;
    anchor.after(overlay);
    return overlay;
  }

  function hide(): void {
    if (overlay) overlay.hidden = true;
    doc.getElementById('chat-messages')?.removeAttribute('hidden');
    doc.getElementById('chat-input-container')?.removeAttribute('hidden');
    visible = false;
    signature = '';
  }

  function show(label: string, entries: ChildTranscriptEntry[], onBack: () => void, status?: string): void {
    const node = ensure();
    if (!node) return;
    const next = JSON.stringify([label, entries, status]);
    if (visible && signature === next) return;
    const follow = !visible || node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    const scrollTop = node.scrollTop;
    signature = next;
    node.replaceChildren();
    const banner = doc.createElement('header');
    banner.className = 'csai-subagent-banner';
    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'csai-subagent-banner-back';
    back.textContent = 'Back to conversation';
    back.addEventListener('click', onBack);
    const title = doc.createElement('span');
    title.className = 'csai-subagent-banner-label';
    title.textContent = label + ' · Read-only · Subagent conversation';
    banner.append(back, title);
    node.append(banner);
    const view = createMessageView({
      doc, messages: () => node, t: (_key, fallback) => fallback, locale: () => doc.documentElement.lang || 'en-US',
      markdown: { available: () => true, format: text => formatMarkdownToHtml(text, { profile: 'chat' }), stripSuspiciousImages },
      copy: { clipboard: () => doc.defaultView?.navigator.clipboard || null, execCopy: () => false, alert: text => doc.defaultView?.alert(text), onCopied: () => {}, error: () => {} },
      setTimer: (callback, ms) => doc.defaultView?.setTimeout(callback, ms),
      attachMcpCalls: () => {}, deferMcpCalls: () => {}, applyScroll: () => {}, projectName: () => '', noProjectName: () => '',
    });
    if (status || !entries.length) {
      const note = doc.createElement('p');
      note.className = 'csai-subagent-empty';
      note.setAttribute('role', 'status');
      note.textContent = status || 'No activity recorded for this dispatch yet.';
      node.append(note);
    }
    for (const entry of entries) {
      if (entry.type === 'start') view.addMessage('user', entry.prompt || '(no task description)');
      if (entry.type === 'message' && entry.text) view.addMessage('assistant', entry.text);
      if (entry.type === 'tool_call' || entry.type === 'tool_result') {
        const details = doc.createElement('details');
        details.className = 'csai-subagent-tool';
        details.open = true;
        const summary = doc.createElement('summary');
        summary.textContent = (entry.toolName || 'Tool') + (entry.type === 'tool_result' ? (entry.isError ? ' · error' : ' · result') : ' · call');
        const pre = doc.createElement('pre');
        pre.textContent = entry.type === 'tool_call' ? JSON.stringify(entry.argumentsObj, null, 2) : entry.content;
        details.append(summary, pre);
        node.append(details);
      }
      if (entry.type === 'end') view.addMessage('system', entry.cancelled ? 'Cancelled' : entry.error ? 'Failed' : 'Finished');
    }
    // Child events currently carry no timestamps; do not present render time as event time.
    node.querySelectorAll('.message-time').forEach(time => time.remove());
    doc.getElementById('chat-messages')?.setAttribute('hidden', '');
    doc.getElementById('chat-input-container')?.setAttribute('hidden', '');
    node.hidden = false;
    visible = true;
    node.scrollTop = follow ? node.scrollHeight : scrollTop;
  }

  return { show, hide, get visible() { return visible; } };
}
