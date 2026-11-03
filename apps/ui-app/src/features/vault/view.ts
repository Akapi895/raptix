import type { Actions } from '../../ui/actions';
import { isRevoked, sortedByCreatedDesc, type VaultSecret } from './model';
import { VaultError, type VaultService } from './service';

export interface VaultViewDependencies {
  doc: Document;
  service: VaultService;
  actions: Actions;
  t(key: string, params?: Record<string, string | number>): string;
  canRead(): boolean;
  canWrite(): boolean;
}

function el<T extends HTMLElement = HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

function text(doc: Document, tag: string, value: unknown, className?: string): HTMLElement {
  const node = doc.createElement(tag);
  node.textContent = value == null ? '' : String(value);
  if (className) node.className = className;
  return node;
}

export function createVaultView(dependencies: VaultViewDependencies) {
  const { doc, service, actions, t } = dependencies;
  const disposers: (() => void)[] = [];

  const feedback = (message: string | null, error = false) => {
    const target = el(doc, 'vault-feedback');
    if (!target) return;
    target.textContent = message ?? '';
    target.hidden = !message;
    target.classList.toggle('is-error', error);
  };

  function renderProjectSelect(): void {
    const select = el<HTMLSelectElement>(doc, 'vault-project-select');
    if (!select) return;
    const current = service.state.projectId;
    select.replaceChildren(...service.state.projects.map((project) => {
      const option = doc.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.id === current;
      return option;
    }));
    select.disabled = !dependencies.canRead() || service.state.busy || service.state.projects.length === 0;
  }

  function renderRow(secret: VaultSecret, revocable: boolean): HTMLElement {
    const row = doc.createElement('article');
    row.className = 'vault-secret-row';
    row.classList.toggle('is-revoked', isRevoked(secret));
    const main = doc.createElement('div');
    main.className = 'vault-secret-main';
    main.append(text(doc, 'span', secret.name, 'vault-secret-name'));
    if (secret.description) main.append(text(doc, 'span', secret.description, 'vault-secret-description'));
    const revealed = service.revealedValue(secret.id);
    const valueEl = text(doc, 'code', revealed ?? '••••••••', 'vault-secret-value');
    valueEl.classList.toggle('is-revealed', revealed !== null);
    main.append(valueEl);
    if (isRevoked(secret)) main.append(text(doc, 'span', t('revoked'), 'vault-secret-badge'));

    const actionsEl = doc.createElement('div');
    actionsEl.className = 'vault-secret-actions';
    if (!isRevoked(secret)) {
      const revealBtn = text(doc, 'button', t(revealed ? 'hide' : 'reveal'), 'btn-secondary') as HTMLButtonElement;
      revealBtn.type = 'button';
      revealBtn.disabled = !dependencies.canRead() || service.state.busy;
      revealBtn.addEventListener('click', () => {
        if (revealed !== null) { service.hide(secret.id); return; }
        service.reveal(secret).catch((error) => feedback((error as VaultError).message, true));
      });
      actionsEl.append(revealBtn);
      if (revocable) {
        const revokeBtn = text(doc, 'button', t('revoke'), 'btn-secondary') as HTMLButtonElement;
        revokeBtn.type = 'button';
        revokeBtn.disabled = !dependencies.canWrite() || service.state.busy;
        revokeBtn.addEventListener('click', () => {
          if (!doc.defaultView?.confirm(t('revokeConfirm', { name: secret.name }))) return;
          service.revoke(secret).catch((error) => feedback((error as VaultError).message, true));
        });
        const promoteBtn = text(doc, 'button', t('promote'), 'btn-secondary') as HTMLButtonElement;
        promoteBtn.type = 'button';
        promoteBtn.disabled = !dependencies.canWrite() || service.state.busy;
        promoteBtn.addEventListener('click', () => {
          if (!doc.defaultView?.confirm(t('promoteConfirm', { name: secret.name }))) return;
          service.promote(secret).catch((error) => feedback((error as VaultError).message, true));
        });
        actionsEl.append(revokeBtn, promoteBtn);
      }
    }
    row.append(main, actionsEl);
    return row;
  }

  function renderList(hostId: string, secrets: readonly VaultSecret[], revocable: boolean, emptyKey: string): void {
    const host = el(doc, hostId);
    if (!host) return;
    host.replaceChildren();
    const sorted = sortedByCreatedDesc(secrets);
    if (!sorted.length) { host.append(text(doc, 'p', t(emptyKey), 'vault-empty')); return; }
    sorted.forEach((secret) => host.append(renderRow(secret, revocable)));
  }

  function render(): void {
    renderProjectSelect();
    renderList('vault-secrets', service.state.secrets, true, 'emptySecrets');
    renderList('vault-global-secrets', service.state.globalSecrets, false, 'emptyGlobal');
    const addBtn = el<HTMLButtonElement>(doc, 'vault-add');
    if (addBtn) addBtn.disabled = !dependencies.canWrite() || service.state.busy || !service.state.projectId;
  }

  function openAddDialog(): void {
    if (!dependencies.canWrite() || !service.state.projectId || service.state.busy) return;
    const dialog = el<HTMLDialogElement>(doc, 'vault-add-dialog');
    if (!dialog) return;
    (el<HTMLInputElement>(doc, 'vault-add-name') ?? { value: '' }).value = '';
    (el<HTMLInputElement>(doc, 'vault-add-value') ?? { value: '' }).value = '';
    (el<HTMLInputElement>(doc, 'vault-add-description') ?? { value: '' }).value = '';
    feedback(null);
    if (!dialog.dataset.vaultBound) {
      dialog.dataset.vaultBound = 'true';
      const onCancel = (event: Event) => { event.preventDefault(); closeAddDialog(); };
      dialog.addEventListener('cancel', onCancel);
      disposers.push(() => dialog.removeEventListener('cancel', onCancel));
    }
    dialog.showModal();
    el<HTMLInputElement>(doc, 'vault-add-name')?.focus();
  }

  function closeAddDialog(): void {
    const dialog = el<HTMLDialogElement>(doc, 'vault-add-dialog');
    if (dialog?.open) dialog.close();
  }

  async function commitAdd(): Promise<void> {
    const name = el<HTMLInputElement>(doc, 'vault-add-name')?.value ?? '';
    const value = el<HTMLInputElement>(doc, 'vault-add-value')?.value ?? '';
    const description = el<HTMLInputElement>(doc, 'vault-add-description')?.value ?? '';
    try {
      await service.add(name, value, description);
      closeAddDialog();
      feedback(t('secretAdded'));
    } catch (error) {
      feedback((error as VaultError).message, true);
    }
  }

  function bind(): () => void {
    const offService = service.subscribe(render);
    disposers.push(offService);
    const select = el<HTMLSelectElement>(doc, 'vault-project-select');
    if (select) {
      const onChange = () => {
        service.selectProject(select.value);
        void service.load().catch((error) => feedback((error as VaultError).message, true));
      };
      select.addEventListener('change', onChange);
      disposers.push(() => select.removeEventListener('change', onChange));
    }
    const unbindActions = [
      actions.register('vault.add', openAddDialog),
      actions.register('vault.dialog.close', closeAddDialog),
      actions.register('vault.dialog.commit', (_element, event) => { event.preventDefault(); void commitAdd(); }),
    ];
    disposers.push(...unbindActions);
    return () => disposers.splice(0).reverse().forEach((dispose) => dispose());
  }

  return {
    bind,
    render,
    loadFeedback: feedback,
    dispose(): void {
      service.dispose();
      disposers.splice(0).reverse().forEach((dispose) => dispose());
    },
  };
}

export type VaultView = ReturnType<typeof createVaultView>;
