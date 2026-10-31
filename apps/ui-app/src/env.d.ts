/// <reference types="vite/client" />
declare const __MOCK_ENABLED__: boolean;

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_MOCK?: string;
}
