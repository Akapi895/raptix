import type { Actions } from '../../ui/actions';
import { escapeHtml } from '../../ui/format';
import { elementAllowed, pagePermission, requiresPermissionElement } from './permissions';
import type { AuthService, AuthSnapshot, RobotBinding } from './service';

export interface AuthViewDependencies {
  doc: Document;
  service: AuthService;
  actions: Actions;
  /** Translate with a fallback that also fills {{name}} placeholders. */
  t(key: string, fallback: string, options?: Record<string, string | number>): string;
  notify(message: string, type?: 'success' | 'error' | 'info'): void;
  openModal(id: string): void;
  closeModal(id: string): void;
  isModalOpen(id: string): boolean;
  /** Runs after a successful login or a restored session. */
  onAuthenticated(firstTime: boolean): Promise<void>;
  /** Other views (vulnerability alert binding) refresh when bindings change. */
  onRobotBindingsChanged(): void;
  confirm(message: string): boolean;
}

const BINDING_LIFETIME_MS = 5 * 60 * 1000;
const PLATFORM_LABELS: Record<string, string> = {
  wechat: 'WeChat', wecom: 'WeCom', dingtalk: 'DingTalk', lark: 'Lark', telegram: 'Telegram', slack: 'Slack', discord: 'Discord', qq: 'QQ',
};

function byId<T extends HTMLElement = HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

function scopeKey(scope: string): string {
  const normalized = scope.trim().toLowerCase();
  if (normalized === 'all') return 'header.scopeAll';
  if (normalized === 'assigned') return 'header.scopeAssigned';
  if (normalized === 'own') return 'header.scopeOwn';
  return 'header.scopeUnknown';
}

export function createAuthView(dependencies: AuthViewDependencies) {
  const { doc, service, actions, t } = dependencies;
  const disposers: (() => void)[] = [];
  let robotCountdown: ReturnType<typeof setInterval> | null = null;
  let robotExpiresAt = 0;
  let robotCode = '';
  let robotLifetimeMs = BINDING_LIFETIME_MS;

  const displayName = (snapshot: AuthSnapshot): string =>
    snapshot.user ? (snapshot.user.display_name || snapshot.user.username || '').trim() : '';
  const displayNameOrUnknown = (snapshot: AuthSnapshot): string =>
    displayName(snapshot) || t('header.unknownUser', 'Unknown user');

  // ---- login overlay ----
  function setPasswordVisible(visible: boolean): void {
    const input = byId<HTMLInputElement>(doc, 'login-password');
    const button = byId(doc, 'login-password-toggle');
    if (input) input.type = visible ? 'text' : 'password';
    if (button) {
      const key = visible ? 'login.hidePassword' : 'login.showPassword';
      const label = t(key, visible ? 'Hide password' : 'Show password');
      button.setAttribute('data-i18n', key);
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  }

  function setLoginError(message: string | null): void {
    const box = byId(doc, 'login-error');
    if (!box) return;
    box.textContent = message ?? '';
    box.style.display = message ? 'block' : 'none';
  }

  function showLoginOverlay(message: string | null = null): void {
    setPasswordVisible(false);
    const overlay = byId(doc, 'login-overlay');
    if (!overlay) return;
    const wasOpen = dependencies.isModalOpen('login-overlay');
    if (!wasOpen) dependencies.openModal('login-overlay');
    // A background request that needs a session re-asks without a message. Keep the rejection the user is
    // reading; only an explicit message or a freshly opened overlay replaces what is shown.
    if (message !== null || !wasOpen) setLoginError(message);
    const username = byId<HTMLInputElement>(doc, 'login-username');
    const password = byId<HTMLInputElement>(doc, 'login-password');
    setTimeout(() => {
      if (username && !username.value) username.focus();
      else password?.focus();
    }, 100);
  }

  function hideLoginOverlay(): void {
    setPasswordVisible(false);
    dependencies.closeModal('login-overlay');
    setLoginError(null);
    const password = byId<HTMLInputElement>(doc, 'login-password');
    if (password) { password.value = ''; password.setAttribute('aria-invalid', 'false'); }
    const username = byId<HTMLInputElement>(doc, 'login-username');
    if (username) {
      username.setAttribute('aria-invalid', 'false');
      if (!service.snapshot().authenticated) username.value = '';
    }
  }

  async function submitLogin(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const username = byId<HTMLInputElement>(doc, 'login-username');
    const password = byId<HTMLInputElement>(doc, 'login-password');
    const submit = doc.querySelector<HTMLButtonElement>('.login-submit');
    if (!password) return;
    username?.setAttribute('aria-invalid', 'false');
    password.setAttribute('aria-invalid', 'false');

    const name = username?.value.trim() ?? '';
    if (!name || Array.from(name).length > 64) {
      username?.setAttribute('aria-invalid', 'true');
      setLoginError(t('auth.usernameRequired', 'Enter a username of at most 64 characters'));
      username?.focus();
      return;
    }
    const secret = password.value.trim();
    if (!secret) {
      password.setAttribute('aria-invalid', 'true');
      setLoginError(t('auth.enterPassword', 'Please enter password'));
      password.focus();
      return;
    }

    if (submit) submit.disabled = true;
    try {
      const result = await service.login(name, secret);
      if (!result.ok) {
        setLoginError(result.message ?? t('auth.loginFailedCheck', 'Sign-in failed, please check the username or password'));
        return;
      }
      hideLoginOverlay();
      applyRbac(doc);
      await dependencies.onAuthenticated(true);
    } catch (error) {
      console.error('Sign-in failed:', error);
      setLoginError(t('auth.loginFailedRetry', 'Sign-in failed, please try again later'));
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function clearLoginFieldError(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target || (target.id !== 'login-username' && target.id !== 'login-password')) return;
    target.setAttribute('aria-invalid', 'false');
    setLoginError(null);
  }

  // ---- user menu ----
  function renderProfile(snapshot: AuthSnapshot = service.snapshot()): void {
    const name = displayNameOrUnknown(snapshot);
    const set = (id: string, text: string) => { const el = byId(doc, id); if (el) el.textContent = text; };
    set('user-menu-display-name', name);
    set('user-menu-username', snapshot.user ? `@${snapshot.user.username}` : '-');
    set('user-menu-scope', snapshot.scope ? t(scopeKey(snapshot.scope), 'Unknown resource scope') : t('header.scopeUnknown', 'Unknown scope'));
    set('user-menu-roles', t('header.rolesCount', '{{count}} roles', { count: snapshot.roles.length }));
    set('user-menu-permissions', t('header.permissionsCount', '{{count}} permissions', { count: snapshot.permissions.size }));
    const avatar = byId(doc, 'user-avatar-btn');
    if (avatar) {
      if (snapshot.authenticated) {
        avatar.setAttribute('title', name);
        avatar.setAttribute('aria-label', t('header.userMenuFor', 'User menu: {{name}}', { name }));
      } else {
        avatar.setAttribute('aria-label', t('header.userMenu', 'User menu'));
      }
    }
  }

  function setUserMenuOpen(open: boolean): void {
    const dropdown = byId(doc, 'user-menu-dropdown');
    const avatar = byId(doc, 'user-avatar-btn');
    if (!dropdown) return;
    dropdown.style.display = open ? 'block' : 'none';
    if (avatar) {
      avatar.classList.toggle('active', open);
      avatar.setAttribute('aria-expanded', String(open));
    }
    if (open) renderProfile();
  }

  function toggleUserMenu(): void {
    const dropdown = byId(doc, 'user-menu-dropdown');
    setUserMenuOpen(dropdown?.style.display === 'none' || dropdown?.style.display === '');
  }

  // ---- RBAC on the DOM ----
  const has = (permission: string) => service.hasPermission(permission);

  function applyPermissionElement(element: HTMLElement): void {
    const allowed = elementAllowed(has, element);
    element.hidden = !allowed;
    element.classList.toggle('rbac-permission-denied', !allowed);
    // Permission and page state are separate: a control disabled for its own reason
    // carries data-state-disabled and stays disabled even for allowed users.
    const blockedByState = element.dataset.stateDisabled === 'true';
    const disabled = !allowed || blockedByState;
    if ('disabled' in element) (element as HTMLButtonElement).disabled = disabled;
    element.setAttribute('aria-hidden', String(!allowed));
    element.setAttribute('aria-disabled', String(disabled));
  }

  function applyRbac(root: ParentNode = doc): void {
    doc.querySelectorAll<HTMLElement>('[data-page]').forEach(element => {
      if (requiresPermissionElement(element)) { applyPermissionElement(element); return; }
      const permission = pagePermission(element.dataset.page);
      if (!permission) return;
      const allowed = has(permission);
      element.hidden = !allowed;
      element.setAttribute('aria-hidden', String(!allowed));
    });
    root.querySelectorAll<HTMLElement>('[data-require-permission], [data-require-permission-any]').forEach(applyPermissionElement);
    const avatar = doc.querySelector<HTMLElement>('.user-avatar-btn');
    const snapshot = service.snapshot();
    if (avatar && snapshot.authenticated) {
      const name = displayNameOrUnknown(snapshot);
      avatar.setAttribute('title', name);
      avatar.setAttribute('aria-label', t('header.userMenuFor', 'User menu: {{name}}', { name }));
    }
    renderProfile(snapshot);
  }

  function installPermissionGuard(): void {
    const guard = (event: Event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-require-permission], [data-require-permission-any]')
        : null;
      if (!target || elementAllowed(has, target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      dependencies.notify(t('auth.forbidden', 'Insufficient permissions'), 'error');
    };
    doc.addEventListener('click', guard, true);
    disposers.push(() => doc.removeEventListener('click', guard, true));
  }

  // ---- robot account binding ----
  function stopCountdown(): void {
    if (robotCountdown) clearInterval(robotCountdown);
    robotCountdown = null;
  }

  function updateCountdown(): void {
    if (!robotExpiresAt) return;
    const remaining = Math.max(0, robotExpiresAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    const countdown = byId(doc, 'robot-binding-countdown');
    const progress = byId(doc, 'robot-binding-progress-bar');
    const expiry = byId(doc, 'robot-binding-expiry');
    if (countdown) countdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, remaining / robotLifetimeMs * 100))}%`;
    if (expiry && robotCode) expiry.textContent = `Send: bind ${robotCode}`;
    if (remaining <= 0) expireBindingCode();
  }

  function startCountdown(): void {
    stopCountdown();
    updateCountdown();
    robotCountdown = setInterval(updateCountdown, 250);
  }

  function setGenerateLabel(label: string, disabled: boolean): void {
    const button = byId<HTMLButtonElement>(doc, 'robot-binding-generate-btn');
    if (!button) return;
    button.disabled = disabled;
    button.textContent = label;
  }

  async function generateBindingCode(): Promise<void> {
    setGenerateLabel('Generating…', true);
    try {
      const { code, expiresInSeconds } = await service.requestBindingCode();
      robotCode = code;
      robotLifetimeMs = Math.max(1000, expiresInSeconds * 1000);
      // Server-provided lifetime, not wall-clock comparison, so client clock skew does not matter.
      robotExpiresAt = Date.now() + robotLifetimeMs;
      const codeEl = byId(doc, 'robot-binding-code');
      const copy = byId<HTMLButtonElement>(doc, 'robot-binding-copy-btn');
      const card = byId(doc, 'robot-binding-code-card');
      const timer = byId(doc, 'robot-binding-timer');
      const state = byId(doc, 'robot-binding-code-state');
      if (codeEl) codeEl.textContent = code;
      if (copy) copy.disabled = false;
      if (card) card.className = 'robot-binding-code-card is-active';
      if (timer) timer.hidden = false;
      if (state) state.textContent = 'Waiting for binding';
      setGenerateLabel('Regenerate', false);
      startCountdown();
    } catch {
      dependencies.notify('Failed to generate the binding code; check the network connection', 'error');
      setGenerateLabel(robotCode ? 'Regenerate' : 'Generate binding code', false);
    }
  }

  function expireBindingCode(): void {
    stopCountdown();
    robotExpiresAt = 0;
    robotCode = '';
    const set = (id: string, text: string) => { const el = byId(doc, id); if (el) el.textContent = text; };
    const card = byId(doc, 'robot-binding-code-card');
    if (card) card.className = 'robot-binding-code-card is-expired';
    set('robot-binding-code', 'Expired');
    set('robot-binding-code-state', 'Expired');
    set('robot-binding-expiry', 'The binding code has expired. Generate a new one.');
    set('robot-binding-countdown', '00:00');
    const progress = byId(doc, 'robot-binding-progress-bar');
    if (progress) progress.style.width = '0%';
    const copy = byId<HTMLButtonElement>(doc, 'robot-binding-copy-btn');
    if (copy) copy.disabled = true;
    setGenerateLabel('Regenerate', false);
    void loadBindings();
  }

  async function copyBindingCode(): Promise<void> {
    if (!robotCode || robotExpiresAt <= Date.now()) return;
    const command = `bind ${robotCode}`;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const area = doc.createElement('textarea');
      area.value = command;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      area.select();
      doc.execCommand('copy');
      area.remove();
    }
    const label = byId(doc, 'robot-binding-copy-btn')?.querySelector('span');
    if (label) {
      label.textContent = 'Copied';
      setTimeout(() => { label.textContent = 'Copy command'; }, 1400);
    }
    dependencies.notify('Binding command copied', 'success');
  }

  function formatTime(value: string | null | undefined): string {
    const date = new Date(value ?? '');
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderBindings(bindings: RobotBinding[]): void {
    const list = byId(doc, 'robot-account-binding-list');
    if (!list) return;
    if (!bindings.length) {
      list.innerHTML = `<div class="robot-binding-empty-state">
        <span class="robot-binding-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2"/></svg></span>
        <div><strong>No bound accounts</strong><p>Generate a binding code and send it in the bot to complete the first binding.</p></div>
      </div>`;
      return;
    }
    list.innerHTML = bindings.map(binding => {
      const label = PLATFORM_LABELS[binding.platform] ?? binding.platform ?? '-';
      const initial = (PLATFORM_LABELS[binding.platform] ?? binding.platform ?? '?').slice(0, 1).toUpperCase();
      return `<div class="robot-binding-account-card">
        <span class="robot-binding-platform-icon">${escapeHtml(initial)}</span>
        <div class="robot-binding-account-main">
          <div class="robot-binding-account-name"><strong>${escapeHtml(label)}</strong><span>Connected</span></div>
          <small>Account ${escapeHtml(binding.external_user_hint || '-')} · Updated ${escapeHtml(formatTime(binding.updated_at))}</small>
        </div>
        <button type="button" class="btn-secondary btn-small robot-binding-unbind-btn" data-action="auth.robotBinding.delete" data-id="${escapeHtml(binding.id)}">Unbind</button>
      </div>`;
    }).join('');
  }

  async function loadBindings(): Promise<void> {
    const list = byId(doc, 'robot-account-binding-list');
    if (!list) return;
    try {
      renderBindings(await service.listBindings());
    } catch (error) {
      list.textContent = error instanceof Error ? error.message : 'Failed to load bindings';
    }
    dependencies.onRobotBindingsChanged();
  }

  function openBindingModal(): void {
    setUserMenuOpen(false);
    dependencies.openModal('robot-account-binding-modal');
    if (robotExpiresAt) startCountdown();
    void loadBindings();
  }

  function closeBindingModal(): void {
    dependencies.closeModal('robot-account-binding-modal');
    dependencies.onRobotBindingsChanged();
  }

  async function deleteBinding(id: string): Promise<void> {
    if (!id || !dependencies.confirm('Unbind this bot account?')) return;
    try {
      await service.deleteBinding(id);
      await loadBindings();
    } catch (error) {
      dependencies.notify(error instanceof Error ? error.message : 'Unbind failed', 'error');
    }
  }

  // ---- lifecycle ----
  function bind(): () => void {
    const form = byId<HTMLFormElement>(doc, 'login-form');
    if (form) {
      const onSubmit = (event: Event) => { void submitLogin(event as SubmitEvent); };
      const onInput = (event: Event) => clearLoginFieldError(event);
      form.addEventListener('submit', onSubmit);
      form.addEventListener('input', onInput);
      disposers.push(() => { form.removeEventListener('submit', onSubmit); form.removeEventListener('input', onInput); });
    }
    installPermissionGuard();

    const closeMenu = (event: Event) => {
      const dropdown = byId(doc, 'user-menu-dropdown');
      const avatar = doc.querySelector('.user-avatar-btn');
      const target = event.target as Node | null;
      if (dropdown && avatar && target && !dropdown.contains(target) && !avatar.contains(target)) setUserMenuOpen(false);
    };
    doc.addEventListener('click', closeMenu);
    disposers.push(() => doc.removeEventListener('click', closeMenu));

    const onLanguage = () => renderProfile();
    doc.addEventListener('languagechange', onLanguage);
    disposers.push(() => doc.removeEventListener('languagechange', onLanguage));

    const offChanged = service.subscribe(snapshot => { renderProfile(snapshot); });
    const offRequired = service.onLoginRequired(detail => { showLoginOverlay(detail.message ? t(detail.message, detail.message) : null); });
    disposers.push(offChanged, offRequired);

    const unbindActions = [
      actions.register('auth.togglePassword', () => setPasswordVisible(byId<HTMLInputElement>(doc, 'login-password')?.type === 'password')),
      actions.register('auth.toggleUserMenu', toggleUserMenu),
      actions.register('auth.logout', () => {
        setUserMenuOpen(false);
        void service.logout().then(() => {
          hideLoginOverlay();
          showLoginOverlay(t('auth.loggedOut', 'Signed out'));
        });
      }),
      actions.register('auth.robotBinding.open', openBindingModal),
      actions.register('auth.robotBinding.close', closeBindingModal),
      actions.register('auth.robotBinding.generate', () => { void generateBindingCode(); }),
      actions.register('auth.robotBinding.copy', () => { void copyBindingCode(); }),
      actions.register('auth.robotBinding.delete', element => { void deleteBinding(element.dataset.id ?? ''); }),
      actions.register('auth.robotBinding.reload', () => { void loadBindings(); }),
      // Menu items are role=menuitem elements; Enter and Space activate them like a button.
      actions.register('ui.activateOnKey', (element, event) => {
        const key = (event as KeyboardEvent).key;
        if (key !== 'Enter' && key !== ' ') return;
        event.preventDefault();
        element.click();
      }),
    ];
    disposers.push(...unbindActions);
    return () => disposers.splice(0).reverse().forEach(dispose => dispose());
  }

  return {
    bind,
    applyRbac,
    showLoginOverlay,
    hideLoginOverlay,
    renderProfile,
    setUserMenuOpen,
    /** Commands for the compatibility layer; the same functions back the data-action names. */
    commands: {
      togglePassword: () => setPasswordVisible(byId<HTMLInputElement>(doc, 'login-password')?.type === 'password'),
      toggleUserMenu,
      logout: () => {
        setUserMenuOpen(false);
        return service.logout().then(() => {
          hideLoginOverlay();
          showLoginOverlay(t('auth.loggedOut', 'Signed out'));
        });
      },
      openRobotBinding: openBindingModal,
      closeRobotBinding: closeBindingModal,
      generateBindingCode,
      copyBindingCode,
    },
    dispose(): void {
      stopCountdown();
      disposers.splice(0).reverse().forEach(dispose => dispose());
    },
  };
}

export type AuthView = ReturnType<typeof createAuthView>;
