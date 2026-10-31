import type { WechatDependencies, WechatModel } from './types';
import type { WechatService } from './service';

export function createWechatView(document: Document, deps: WechatDependencies) {
  const get = (id: string) => document.getElementById('robot-wechat-' + id);
  const input = (id: string) => document.querySelector<HTMLInputElement>('#robot-wechat-' + id);
  const hidden = (id: string, value: boolean) => { const el = get(id); if (el) el.hidden = value; };
  const t = (key: string, fallback: string) => { const text = deps.translate('settings.robots.wechat.' + key); return text && text !== 'settings.robots.wechat.' + key ? text : fallback; };
  let revision = -1;
  function ensureDecorations(): void {
    const panel = get('scan-panel');
    if (panel && !panel.querySelector('.robot-wechat-steps')) {
      const ol = document.createElement('ol'); ol.className = 'robot-wechat-steps';
      for (const [key, fallback] of [['step1', 'Generate QR code'], ['step2', 'Scan with WeChat'], ['step3', 'Confirm binding']]) {
        const li = document.createElement('li'); li.className = 'robot-wechat-step'; li.textContent = t(key || '', fallback || ''); ol.append(li);
      }
      panel.prepend(ol);
    }
    const image = get('qr-img');
    if (image && image.parentElement && !image.parentElement.classList.contains('robot-wechat-qr-frame')) {
      const frame = document.createElement('div'); frame.className = 'robot-wechat-qr-frame'; image.before(frame); frame.append(image);
      const placeholder = get('qr-placeholder') || document.createElement('div');
      placeholder.id = 'robot-wechat-qr-placeholder'; placeholder.className = 'robot-wechat-qr-placeholder'; placeholder.setAttribute('aria-hidden', 'true');
      placeholder.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3v-3zm4 0h3v3h-3v-3zm-4 4h3v3h-3v-3zm4 0h3v3h-3v-3z"/></svg>';
      frame.append(placeholder);
    }
  }
  function render(model: Readonly<WechatModel>): void {
    ensureDecorations();
    const badge = get('status-badge');
    if (badge) {
      badge.classList.remove('robot-wechat-badge--idle', 'robot-wechat-badge--bound', 'robot-wechat-badge--scanning');
      badge.classList.add('robot-wechat-badge--' + model.mode);
      badge.textContent = model.mode === 'bound' ? t('statusBound', 'Connected') : model.mode === 'scanning' ? t('statusScanning', 'Binding…') : t('statusIdle', 'Not bound');
    }
    get('subsection')?.classList.toggle('is-bound', model.mode === 'bound');
    // On generation failure the original leaves the scan panel visible with its error.
    const scanning = model.mode === 'scanning' || (model.mode === 'idle' && !!model.status);
    hidden('qr-wrap', !scanning); hidden('bound-panel', true); hidden('scan-panel', !scanning);
    hidden('verify-wrap', !model.verify); hidden('qr-loading', !model.loading);
    const bind = document.querySelector<HTMLButtonElement>('#robot-wechat-bind-btn');
    if (bind) { bind.disabled = model.loading; bind.dataset.stateDisabled = String(model.loading); bind.textContent = model.mode === 'bound' ? t('rebindButton', 'Re-bind') : t('bindButton', 'Generate QR code and bind'); }
    const phase = ['generate', 'scan', 'confirm'].indexOf(model.phase);
    document.querySelectorAll('.robot-wechat-step').forEach((step, index) => { step.classList.toggle('is-active', index === phase); step.classList.toggle('is-done', index < phase); });
    if (revision !== model.scanRevision) { revision = model.scanRevision; const code = input('verify-code'); if (code) code.value = ''; }
    const image = document.querySelector<HTMLImageElement>('#robot-wechat-qr-img');
    if (image) {
      const source = model.qr?.qrcode_image_data_url;
      if (source && source !== image.getAttribute('src')) {
        image.onload = () => { image.hidden = false; hidden('qr-placeholder', true); };
        image.onerror = () => { image.hidden = true; hidden('qr-placeholder', false); };
        image.src = source;
      } else if (!source) { image.onload = image.onerror = null; image.removeAttribute('src'); image.hidden = true; hidden('qr-placeholder', false); }
    }
    const link = document.querySelector<HTMLAnchorElement>('#robot-wechat-qr-link');
    const url = model.qr?.qrcode_open_url || model.qr?.qrcode_img_url || '';
    if (link) { link.hidden = !url; if (url) link.href = url; }
    const status = get('qr-status');
    if (status) { status.textContent = model.status; status.classList.toggle('is-error', model.error); status.classList.toggle('is-success', !model.error && !!model.status); }
    const summary = get('bound-summary');
    if (summary) {
      const id = model.config.ilink_bot_id || input('ilink-bot-id')?.value.trim() || '';
      summary.hidden = model.mode !== 'bound' || !id; summary.replaceChildren();
      if (id) { const code = document.createElement('code'); code.textContent = id; summary.append(t('boundBotId', 'Bound Bot ID: '), code); }
    }
    if (model.config.enabled && model.config.bound) {
      const enabled = input('enabled'), id = input('ilink-bot-id'); if (enabled) enabled.checked = true;
      if (id && model.config.ilink_bot_id) id.value = model.config.ilink_bot_id;
    }
    const flash = get('bound-flash');
    if (flash) { flash.hidden = model.flashHidden; flash.classList.toggle('is-visible', model.flashVisible); }
    const flashText = get('bound-flash-text'); if (flashText) flashText.textContent = model.flashText;
    const root = get('subsection'); if (root) deps.applyPermissions?.(root);
  }
  function bind(service: WechatService): () => void {
    const root = get('subsection');
    const click = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-wechat-action]');
      if (!button || !root?.contains(button) || button.matches(':disabled, [aria-disabled="true"]')) return;
      event.preventDefault();
      if (button.dataset.wechatAction === 'bind') void service.start(input('bot-type')?.value || '3');
      if (button.dataset.wechatAction === 'verify') void service.verify(input('verify-code')?.value || '');
    };
    root?.addEventListener('click', click);
    return () => { root?.removeEventListener('click', click); const image = document.querySelector<HTMLImageElement>('#robot-wechat-qr-img'); if (image) image.onload = image.onerror = null; };
  }
  return { render, bind };
}
