import type { Request } from '../notifications';
import type { WechatResponse } from './types';

export function createWechatClient(request: Request) {
  async function run(path: string, body?: unknown): Promise<WechatResponse> {
    const response = await request('/api/robot/wechat/qrcode' + path, body === undefined ? { method: 'GET' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json() as WechatResponse;
    if (!response.ok) throw new Error(data.error || data.message || (path.startsWith('/status') ? 'Polling failed' : path === '/verify' ? 'Submit failed' : 'Failed to get QR code'));
    return data;
  }
  return {
    start: (botType: string) => run('', { bot_type: botType }),
    status: (sessionKey: string) => run('/status?session_key=' + encodeURIComponent(sessionKey)),
    verify: (sessionKey: string, code: string) => run('/verify', { session_key: sessionKey, verify_code: code }),
  };
}
export type WechatClient = ReturnType<typeof createWechatClient>;
