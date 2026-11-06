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

  /** A promoted (global) secret is read-only here regardless of which project is selected -- it
   *  can only be revoked/re-promoted from the project that owns it, which this row doesn't know. */
  function renderRow(secret: VaultSecret, revocable: boolean): HTMLElement {
    const row = doc.createElement('tr');
    row.className = 'vault-secret-row';
    row.classList.toggle('is-revoked', isRevoked(secret));

    const nameCell = doc.createElement('td');
    nameCell.append(text(doc, 'span', secret.name, 'vault-secret-name'));
    if (isRevoked(secret)) nameCell.append(text(doc, 'span', t('revoked'), 'vault-secret-badge'));
    row.append(nameCell);

    row.append(text(doc, 'td', secret.description || '—'));

    const revealed = service.revealedValue(secret.id);
    const valueCell = doc.createElement('td');
    const valueEl = text(doc, 'code', revealed ?? '••••••••', 'vault-secret-value');
    valueEl.classList.toggle('is-revealed', revealed !== null);
    valueCell.append(valueEl);
    row.append(valueCell);

    const typeCell = doc.createElement('td');
    typeCell.append(text(doc, 'span', t(secret.scope === 'GLOBAL' ? 'typeGlobal' : 'typeProject'), 'vault-secret-type vault-secret-type--' + secret.scope.toLowerCase()));
    row.append(typeCell);

    row.append(text(doc, 'td', t(isRevoked(secret) ? 'statusRevoked' : 'statusActive')));

    const actionsCell = doc.createElement('td');
    actionsCell.className = 'vault-secret-actions';
    if (!isRevoked(secret)) {
      const revealBtn = text(doc, 'button', t(revealed ? 'hide' : 'reveal'), 'btn-secondary') as HTMLButtonElement;
      revealBtn.type = 'button';
      revealBtn.disabled = !dependencies.canRead() || service.state.busy;
      revealBtn.addEventListener('click', () => {
        if (revealed !== null) { service.hide(secret.id); return; }
        service.reveal(secret).catch((error) => feedback((error as VaultError).message, true));
      });
      actionsCell.append(revealBtn);
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
        actionsCell.append(revokeBtn, promoteBtn);
      }
    }
    row.append(actionsCell);
    return row;
  }

  function render(): void {
    renderProjectSelect();
    const body = el(doc, 'vault-secrets-tbody');
    if (body) {
      body.replaceChildren();
      // Project secrets and their promoted (global) counterparts are the same kind of
      // record at different scopes -- one table, with the Type column as the only
      // distinction, instead of two sections that just duplicate the same row shape.
      const merged = sortedByCreatedDesc([...service.state.secrets, ...service.state.globalSecrets]);
      if (!merged.length) {
        const empty = doc.createElement('tr');
        const cell = doc.createElement('td');
        cell.colSpan = 6;
        cell.className = 'vault-empty';
        cell.textContent = t('emptyAll');
        empty.append(cell);
        body.append(empty);
      } else {
        merged.forEach((secret) => body.append(renderRow(secret, secret.scope === 'PROJECT')));
      }
    }
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
