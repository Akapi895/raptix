import { marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';

export type MarkdownProfile = 'chat' | 'timeline';
export interface MarkdownOptions { profile?: MarkdownProfile }

export const CHAT_SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class'],
  ALLOW_DATA_ATTR: false,
};
export const TIMELINE_SANITIZE_CONFIG: Config = {
  ...CHAT_SANITIZE_CONFIG,
  ALLOWED_TAGS: CHAT_SANITIZE_CONFIG.ALLOWED_TAGS?.filter(tag => tag !== 'img'),
  ALLOWED_ATTR: ['href', 'title', 'alt', 'class'],
};

let hooksInstalled = false;
export function installDomPurifyHooks(): void {
  if (hooksInstalled) return;
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const attr = data.attrName.toLowerCase();
    if (attr !== 'src' && attr !== 'href') return;
    const value = data.attrValue.trim().toLowerCase();
    if (/^(?:javascript:|vbscript:|data:text\/html|data:text\/javascript|data:application\/javascript|blob:)/.test(value)
      || (attr === 'src' && node.nodeName.toLowerCase() === 'img' && value.length <= 2)) {
      data.keepAttr = false;
    }
  });
  hooksInstalled = true;
}

export function escapeHtmlLocal(text: unknown): string {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function looksLikeMarkdown(text: unknown): boolean {
  const source = String(text);
  return /^#{1,6}\s/m.test(source) || /^\s*[-*+]\s/m.test(source) || /^\s*\d+\.\s/m.test(source)
    || /\*\*[^*\n]+\*\*/.test(source) || /`[^`\n]+`/.test(source) || /^```/m.test(source)
    || /^\|.+\|/m.test(source) || /^\s*>\s/m.test(source);
}

export function isHeavyRawHtml(text: unknown): boolean {
  const source = String(text);
  if (looksLikeMarkdown(source)) return false;
  return /<!DOCTYPE\s+html|<\s*html\b/i.test(source)
    || /<\s*(head|body|iframe|object|embed|form|script|style|meta|link|base)\b/i.test(source)
    || (source.match(/<[a-z][^>]*>/gi)?.length ?? 0) >= 8;
}

export function sanitizeRichHtml(html: string, profile: MarkdownProfile = 'chat'): string {
  installDomPurifyHooks();
  return DOMPurify.sanitize(html, profile === 'timeline' ? TIMELINE_SANITIZE_CONFIG : CHAT_SANITIZE_CONFIG);
}

export function formatMarkdownToHtml(
  text: unknown,
  options?: MarkdownOptions | null,
  normalize: (source: string) => string = source => source,
): string {
  const source = normalize(text == null ? '' : String(text));
  if (isHeavyRawHtml(source)) {
    return `<pre class="tool-result sanitized-raw-html-fallback">${escapeHtmlLocal(source)}</pre>`;
  }
  const hasHtml = /<[a-z][\s\S]*>/i.test(source);
  let html = source;
  if (looksLikeMarkdown(source) || !hasHtml) {
    try {
      html = marked.parse(source, { async: false, breaks: true, gfm: true });
    } catch {
      html = hasHtml ? source : escapeHtmlLocal(source).replace(/\n/g, '<br>');
    }
  }
  const root = document.createElement('div');
  // Markdown owns its table scrollers; the generic mobile table enhancer must skip them.
  root.className = 'markdown-content m-no-wrap';
  root.innerHTML = sanitizeRichHtml(html, options?.profile);
  root.querySelectorAll('table').forEach(table => {
    const scroll = document.createElement('div');
    scroll.className = 'table-wrapper markdown-table-scroll';
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Markdown table');
    table.before(scroll);
    scroll.append(table);
  });
  root.querySelectorAll('pre').forEach(pre => { pre.tabIndex = 0; });
  return root.outerHTML;
}

export function stripSuspiciousImages(root: ParentNode | null | undefined): void {
  root?.querySelectorAll('img').forEach(img => {
    const source = (img.getAttribute('src') ?? '').trim();
    if (source.length <= 2) img.remove();
  });
}

export { formatMarkdownToHtml as formatMarkdown };
