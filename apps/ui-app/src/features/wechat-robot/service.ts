import type { WechatClient } from './client';
import type { WechatConfig, WechatDependencies, WechatModel } from './types';

export function createWechatService(client: WechatClient, deps: WechatDependencies, render: (model: Readonly<WechatModel>) => void) {
  const model: WechatModel = { mode: 'idle', phase: 'generate', loading: false, qr: null, status: '', error: false,
    verify: false, scanRevision: 0, config: {}, flashText: '', flashVisible: false, flashHidden: true };
  let disposed = false, sessionKey: string | null = null, generation = 0;
  let pollTimer: number | undefined, flashTimer: number | undefined, flashFrame: number | undefined;
  let inFlightGeneration: number | undefined;
  const emit = () => { if (!disposed) render(model); };
  const t = (key: string, fallback: string) => { const text = deps.translate('settings.robots.wechat.' + key); return text && text !== 'settings.robots.wechat.' + key ? text : fallback; };
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  const valid = (version: number) => !disposed && generation === version;
  function cancelPoll(): void { if (pollTimer !== undefined) deps.runtime.cancel(pollTimer); pollTimer = undefined; }
  function stopPoll(): void { cancelPoll(); ++generation; }
  function clearNotice(): void {
    if (flashTimer !== undefined) deps.runtime.cancel(flashTimer);
    if (flashFrame !== undefined) deps.runtime.cancel(flashFrame);
    flashTimer = flashFrame = undefined; model.flashVisible = false; model.flashHidden = true;
  }
  function success(message: string): void {
    clearNotice(); model.flashText = message; model.flashHidden = false; emit();
    flashFrame = deps.runtime.after(() => { flashFrame = undefined; if (disposed) return; model.flashVisible = true; emit(); }, 0);
    flashTimer = deps.runtime.after(() => {
      model.flashVisible = false; emit();
      flashTimer = deps.runtime.after(() => { flashTimer = undefined; model.flashHidden = true; emit(); }, 300);
    }, 4500);
    deps.toast(message);
  }
  function bound(config: WechatConfig): void {
    stopPoll(); sessionKey = null; model.loading = false; model.mode = 'bound'; model.config = config;
    model.verify = false; model.qr = null; emit(); deps.refreshRobotManager();
  }
  async function poll(): Promise<void> {
    if (disposed || !sessionKey) return;
    const version = generation, key = sessionKey;
    if (inFlightGeneration === version) return;
    cancelPoll(); inFlightGeneration = version;
    try {
      const data = await client.status(key); if (!valid(version)) return;
      switch (data.status) {
        case 'confirmed': {
          cancelPoll(); sessionKey = null; model.phase = 'confirm';
          model.config = { enabled: true, bound: true, ilink_bot_id: data.ilink_bot_id };
          emit(); success(data.message || t('boundSuccess', 'Binding successful. WeChat bot is enabled.'));
          // Settings persists the server's complete config and calls refreshBound.
          // A standalone consumer gets the same compact bound summary as the fallback.
          const loaded = await deps.loadConfig(); if (!valid(version)) return;
          if (!loaded) bound(model.config);
          deps.refreshRobotManager(); return;
        }
        case 'need_verifycode': model.phase = 'scan'; model.verify = true; model.status = data.message || 'Enter the code shown in WeChat on your phone'; model.error = false; break;
        case 'scaned': model.phase = 'confirm'; model.verify = false; model.status = 'QR scanned; confirm on your phone…'; model.error = false; break;
        case 'binded_redirect': success(data.message || t('alreadyBound', 'This WeChat account is already bound.')); bound({ bound: true }); return;
        case 'expired': model.status = 'The QR code has expired. Click "Generate QR code and bind" again.'; model.error = true; model.mode = 'scanning'; cancelPoll(); emit(); return;
        default: model.verify = false; break;
      }
    } catch (error) { if (!valid(version)) return; model.status = errorText(error); model.error = true; }
    finally { if (inFlightGeneration === version) inFlightGeneration = undefined; }
    if (valid(version) && sessionKey === key) {
      emit(); pollTimer = deps.runtime.after(() => { pollTimer = undefined; void poll(); }, 1500);
    }
  }
  async function start(botType: string): Promise<void> {
    if (disposed || !deps.canWrite()) return;
    stopPoll(); const version = generation; sessionKey = null; clearNotice();
    model.mode = 'scanning'; model.phase = 'generate'; model.loading = true; model.qr = null;
    model.status = ''; model.error = false; model.verify = false; model.config = {}; ++model.scanRevision; emit();
    try {
      const data = await client.start(botType.trim() || '3'); if (!valid(version)) return;
      sessionKey = data.session_key || null; model.qr = data;
      if (data.qrcode_image_data_url) model.phase = 'scan';
      model.status = data.message || 'Scan the QR code with WeChat'; emit(); void poll();
    } catch (error) { if (valid(version)) { model.status = errorText(error); model.error = true; model.mode = 'idle'; } }
    finally { if (valid(version)) { model.loading = false; emit(); } }
  }
  async function verify(code: string): Promise<void> {
    const value = code.trim(); if (disposed || !value || !sessionKey || !deps.canWrite()) return;
    const key = sessionKey, version = generation;
    try {
      const data = await client.verify(key, value); if (!valid(version) || sessionKey !== key) return;
      model.status = data.message || 'Pairing code submitted; waiting for confirmation…'; model.error = false; emit();
      // If a long-poll is in flight, let it finish; never create a second chain.
      void poll();
    } catch (error) { if (valid(version)) { model.status = errorText(error); model.error = true; emit(); } }
  }
  function refreshBound(config: WechatConfig = {}): void {
    if (disposed) return;
    const isBound = config.bound || (config.bot_token && config.ilink_bot_id) || !!(config.ilink_bot_id && config.enabled);
    if (isBound) bound(config);
    else { model.config = config; model.mode = 'idle'; clearNotice(); emit(); deps.refreshRobotManager(); }
  }
  return { start, poll, verify, refreshBound, stopPoll, getModel: () => model,
    dispose() { disposed = true; stopPoll(); clearNotice(); sessionKey = null; } };
}
export type WechatService = ReturnType<typeof createWechatService>;
