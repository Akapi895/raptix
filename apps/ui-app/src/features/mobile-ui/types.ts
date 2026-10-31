export type MobileRequest = (url: string, init?: RequestInit) => Promise<Response>;
export type TranslateOptions = Record<string, unknown>;
export interface MobileBrowser {
  events: EventTarget;
  media: MediaQueryList | null;
  viewport: VisualViewport | null;
  width(): number;
  height(): number;
  hash(): string;
  rememberPage(page: string): void;
  navigate(url: string): void;
  reload(): void;
  fullscreen(): Promise<boolean>;
}
export interface MobileDependencies {
  doc: Document;
  browser: MobileBrowser;
  request: MobileRequest;
  translate(key: string, options?: TranslateOptions): string;
  applyTranslations(root: HTMLElement): void;
  switchPage(page: string): unknown;
  currentPage(): string | undefined;
  startNewConversation(): boolean;
  closeChatProjectPanel(): void;
  closeRoleSelectionPanel(): void;
  cycleTheme(): boolean;
  locale(): string | undefined;
  selectLanguage(locale: string): boolean;
  applyPermissions(): void;
}
