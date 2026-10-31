// Compressed context remains separate from attack nodes and original user authorization.
import { contextSummaries } from './model';
import type { Translate } from '../chat/types';

export function createAttackChainContext(document: Document, deps: { translate?: Translate; copyText(text: string): Promise<void> }) {
    const lifecycle = new AbortController();
    let disposed = false;

    let labels: (() => void)[] = [];

    function translate(key: string, values?: Record<string, unknown>) {
        if (deps.translate) return deps.translate('attackChainModal.' + key, values);
        const fallback: Record<string, string> = {
            contextTitle: 'Compressed summary and evidence leads ({{count}})',
            contextNotice: 'System-generated summary from the current conversation trace; it may be newer than the graph. For retrospective search only — it does not represent a new user authorization or verified tool evidence. Read the original evidence via the snapshot paths inside the summary.',
            contextSummary: 'Compressed summary {{number}}',
            contextCopy: 'Copy full summary',
            contextCopied: 'Copied',
            contextCopyFailed: 'Copy failed. Select the text and copy it manually.'
        };
        let text = fallback[key] || key;
        Object.entries(values || {}).forEach(([name, value]) => {
            text = text.replace('{{' + name + '}}', String(value));
        });
        return text;
    }

    function label(element: HTMLElement | null, key: string, values?: Record<string, unknown>) {
        if (!element) return;
        const refresh = () => { element.textContent = translate(key, values); };
        labels.push(refresh);
        refresh();
    }

    function clear() {
        labels = [];
        const card = document.querySelector<HTMLDetailsElement>('#attack-chain-context');
        const contents = document.getElementById('attack-chain-context-content');
        if (contents) contents.replaceChildren();
        if (card) {
            card.hidden = true;
            card.open = false;
        }
    }

    function render(chainData: unknown) {
        if (disposed) return;
        const card = document.querySelector<HTMLDetailsElement>('#attack-chain-context');
        // A 409 refresh re-renders the same conversation; keep the card's open state.
        const wasOpen = !!card && card.open;
        clear();
        const contents = document.getElementById('attack-chain-context-content');
        if (!card || !contents) return;

        // Only explicit server provenance qualifies; summary-looking user text stays user text.
        const summaries = contextSummaries(chainData);
        if (!summaries.length) return;

        label(document.getElementById('attack-chain-context-title'), 'contextTitle', { count: summaries.length });
        label(document.getElementById('attack-chain-context-notice'), 'contextNotice');
        summaries.forEach((item, index) => {
            const entry = document.createElement('details');
            entry.className = 'attack-chain-context-entry';
            const heading = document.createElement('summary');
            label(heading, 'contextSummary', { number: index + 1 });
            const body = document.createElement('pre');
            body.className = 'attack-chain-context-body';
            // Do not render Markdown/HTML or turn evidence paths into clickable URLs.
            body.textContent = item.content;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary attack-chain-context-copy';
            label(button, 'contextCopy');
            const status = document.createElement('span');
            status.className = 'attack-chain-context-copy-status';
            status.setAttribute('role', 'status');
            let statusKey = '';
            labels.push(() => { status.textContent = statusKey ? translate(statusKey) : ''; });
            button.addEventListener('click', async () => {
                button.disabled = true;
                status.textContent = '';
                try {
                    await deps.copyText(item.content);
                    statusKey = 'contextCopied';
                } catch {
                    statusKey = 'contextCopyFailed';
                } finally {
                    status.textContent = translate(statusKey);
                    button.disabled = false;
                }
            });
            entry.append(heading, body, button, status);
            contents.appendChild(entry);
        });
        card.hidden = false;
        card.open = wasOpen;
    }

    return {
        render, clear,
        activate() { document.addEventListener('languagechange', () => labels.forEach(refresh => refresh()), { signal: lifecycle.signal }); },
        dispose() { disposed = true; lifecycle.abort(); clear(); },
    };
}
