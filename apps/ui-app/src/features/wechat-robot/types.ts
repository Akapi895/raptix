import type { Request, Translate } from '../notifications';
import type { NotificationRuntime } from '../../platform/notification-browser';

// internal/config/config.go RobotWechatConfig; handler/wechat_robot.go responses.
export interface WechatConfig {
  enabled?: boolean; bound?: boolean; bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string;
  base_url?: string; bot_type?: string; bot_agent?: string;
}
export interface WechatResponse {
  session_key?: string; qrcode?: string; qrcode_open_url?: string; qrcode_img_url?: string;
  qrcode_image_data_url?: string; status?: string; message?: string; error?: string;
  ilink_bot_id?: string; ilink_user_id?: string; already_connected?: boolean; success?: boolean;
}
export interface WechatModel {
  mode: 'idle' | 'scanning' | 'bound'; phase: 'generate' | 'scan' | 'confirm'; loading: boolean;
  qr: WechatResponse | null; status: string; error: boolean; verify: boolean; scanRevision: number;
  config: WechatConfig; flashText: string; flashVisible: boolean; flashHidden: boolean;
}
export interface WechatDependencies {
  request: Request; translate: Translate; runtime: NotificationRuntime;
  loadConfig(): Promise<boolean>; refreshRobotManager(): void; toast(text: string): void; canWrite(): boolean;
  applyPermissions?(root: HTMLElement): void;
}
