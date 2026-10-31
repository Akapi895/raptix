import { createWechatClient } from './client';
import { createWechatService } from './service';
import { createWechatView } from './view';
import type { WechatDependencies } from './types';
export type { WechatConfig, WechatDependencies } from './types';
export function initWechatRobot(document: Document, deps: WechatDependencies) {
  const view = createWechatView(document, deps), service = createWechatService(createWechatClient(deps.request), deps, view.render);
  let unbind: (() => void) | undefined;
  return { service, activate() { unbind ??= view.bind(service); }, dispose() { unbind?.(); service.dispose(); } };
}
