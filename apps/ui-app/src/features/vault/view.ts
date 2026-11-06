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
  let loadError = false;

  const feedback = (message: string | null, error = false) => {
    const target = el(doc, 'vault-feedback');
    if (!target) return;
    target.textContent = message ?? '';
    target.hidden = !message;
    target.classList.toggle('is-error', error);
  };

  const loadFeedback = (message: string | null, error = false) => {
    loadError = error && !!message;
    feedback(message, error);
    render();
  };

  function iconButton(label: string, path: string): HTMLButtonElement {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'vault-icon-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    button.append(svg);
    return button;
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
    function appendActions(target: HTMLElement): void {
      if (isRevoked(secret)) return;
      const revealBtn = iconButton(t(revealed !== null ? 'hide' : 'reveal'), revealed !== null ? 'M2 2l20 20M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5 0 8.3 4.2 10 7a14 14 0 0 1-3.2 3.8M6.2 6.2A14 14 0 0 0 2 12c1.7 2.8 5 7 10 7 1.2 0 2.3-.2 3.3-.6' : 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z');
      revealBtn.disabled = !dependencies.canRead() || service.state.busy;
      revealBtn.addEventListener('click', () => {
        if (revealed !== null) { service.hide(secret.id); return; }
        service.reveal(secret).catch((error) => feedback((error as VaultError).message, true));
      });
      target.append(revealBtn);
      if (revocable) {
        const revokeBtn = iconButton(t('revoke'), 'M18 6 6 18M6 6l12 12M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z');
        revokeBtn.disabled = !dependencies.canWrite() || service.state.busy;
        revokeBtn.addEventListener('click', () => {
          if (!doc.defaultView?.confirm(t('revokeConfirm', { name: secret.name }))) return;
          service.revoke(secret).catch((error) => feedback((error as VaultError).message, true));
        });
        const promoteBtn = iconButton(t('promote'), 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20');
        promoteBtn.disabled = !dependencies.canWrite() || service.state.busy;
        promoteBtn.addEventListener('click', () => {
          if (!doc.defaultView?.confirm(t('promoteConfirm', { name: secret.name }))) return;
          service.promote(secret).catch((error) => feedback((error as VaultError).message, true));
        });
        target.append(revokeBtn, promoteBtn);
      }
    }
    if (!isRevoked(secret)) {
      const desktop = doc.createElement('div');
      desktop.className = 'vault-actions-desktop';
      appendActions(desktop);
      const menu = doc.createElement('details');
      menu.className = 'vault-actions-menu';
      const summary = doc.createElement('summary');
      summary.className = 'vault-icon-button';
      summary.setAttribute('aria-label', `Actions: ${secret.name}`);
      summary.title = 'Actions';
      summary.append(iconButton('Actions', 'M12 5h.01M12 12h.01M12 19h.01').firstChild!);
      const options = doc.createElement('div');
      options.className = 'vault-actions-options';
      appendActions(options);
      menu.append(summary, options);
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus(); }
      });
      actionsCell.append(desktop, menu);
    }
    row.append(actionsCell);
    return row;
  }

  function render(): void {
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
        cell.textContent = !service.state.projectId ? 'Select a project in the top bar to view its secrets.' : service.state.busy && !service.state.loaded ? 'Loading secrets…' : loadError ? 'Secrets could not be loaded. Reopen Vault to try again.' : t('emptyAll');
        cell.setAttribute('role', 'status');
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
    const dialogFeedback = el(doc, 'vault-dialog-feedback');
    if (dialogFeedback) { dialogFeedback.hidden = true; dialogFeedback.textContent = ''; }
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
      const target = el(doc, 'vault-dialog-feedback');
      if (target) { target.textContent = (error as VaultError).message; target.hidden = false; }
    }
  }

  function bind(): () => void {
    const offService = service.subscribe(render);
    disposers.push(offService);
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
    closeAddDialog,
    loadFeedback,
    dispose(): void {
      service.dispose();
      disposers.splice(0).reverse().forEach((dispose) => dispose());
    },
  };
}

export type VaultView = ReturnType<typeof createVaultView>;
