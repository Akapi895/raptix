import type { Actions } from '../../ui/actions';
import { FIELD_LIMITS, type GuardRule, type GuardTestResult, type RuleField } from './model';
import { GuardError, type AddDraft, type ToolGuardService } from './service';

export interface ToolGuardViewDependencies {
  doc: Document;
  service: ToolGuardService;
  actions: Actions;
  t(key: string, params?: Record<string, string | number>): string;
  canRead(): boolean;
  canWrite(): boolean;
}

interface LocalTest {
  rule: GuardRule;
  root: HTMLElement;
  tool: HTMLInputElement;
  args: HTMLTextAreaElement;
  run: HTMLButtonElement;
  output: HTMLElement;
  feedback: HTMLElement;
  result: HTMLElement;
  placeholder: HTMLElement;
  fields: Partial<Record<RuleField, HTMLInputElement | HTMLTextAreaElement>>;
  testing: boolean;
  disposed: boolean;
  revision: number;
}

interface RuleView {
  rule: GuardRule;
  card: HTMLElement;
  summary: HTMLButtonElement;
  editor: HTMLElement;
  title: HTMLElement;
  preview: HTMLElement;
  badge: HTMLElement;
  status: HTMLElement;
  checkbox: HTMLInputElement;
  remove: HTMLButtonElement;
  close: HTMLButtonElement;
  validate: HTMLButtonElement;
  fields: Partial<Record<RuleField, HTMLInputElement | HTMLTextAreaElement>>;
  tester: LocalTest;
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

/** Text fields with the editor's labels, ids and aria wiring, as the original panel built them. */
function ruleField(doc: Document, t: ToolGuardViewDependencies['t'], rule: GuardRule, index: string | number, key: RuleField,
  label: string, multiline: boolean, fields: Partial<Record<RuleField, HTMLInputElement | HTMLTextAreaElement>>,
  onInput: () => void): HTMLElement {
  const field = doc.createElement('div');
  field.className = `tool-guard-field tool-guard-field--${key}`;
  const input = doc.createElement(multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
  input.id = `tool-guard-rule-${index}-${key}`;
  input.value = rule[key] ?? '';
  input.maxLength = FIELD_LIMITS[key];
  input.spellcheck = false;
  if (multiline) (input as HTMLTextAreaElement).rows = 3;
  else (input as HTMLInputElement).type = 'text';
  if (key === 'pattern') input.className = 'tool-guard-pattern';
  const labelNode = text(doc, 'label', t(label)) as HTMLLabelElement;
  labelNode.htmlFor = input.id;
  input.addEventListener('input', () => {
    rule[key] = input.value;
    onInput();
  });
  fields[key] = input;
  field.append(labelNode, input);
  if (key === 'message') {
    const hint = text(doc, 'p', t('messageHint'), 'tool-guard-hint tool-guard-field-hint');
    hint.id = `${input.id}-hint`;
    input.setAttribute('aria-describedby', hint.id);
    field.append(hint);
  }
  return field;
}

export function createToolGuardView(dependencies: ToolGuardViewDependencies) {
  const { doc, service, actions, t } = dependencies;
  const ruleViews = new Map<string, RuleView>();
  const disposers: (() => void)[] = [];

  const feedback = (message: string | null, error = false) => {
    const target = el(doc, 'tool-guard-feedback');
    if (!target) return;
    target.textContent = message ?? '';
    target.hidden = !message;
    target.classList.toggle('is-error', error);
  };

  const showLocal = (target: HTMLElement, message: string | null) => {
    target.textContent = message ?? '';
    target.hidden = !message;
    target.classList.toggle('is-error', !!message);
  };

  // ---- controls ----
  function updateLocalTestControls(tester: LocalTest | undefined): void {
    if (!tester) return;
    const busy = service.state.busy;
    tester.run.disabled = !dependencies.canRead() || busy || tester.testing || tester.disposed;
    tester.run.textContent = t(tester.testing ? 'testing' : 'test');
    tester.output.setAttribute('aria-busy', String(tester.testing));
    tester.tool.disabled = !dependencies.canRead() || busy;
    tester.args.disabled = !dependencies.canRead() || busy;
  }

  function updateRuleView(view: RuleView): void {
    const { rule, card, summary, editor, title, preview, badge, status, checkbox } = view;
    const expanded = service.state.openRuleId === rule.id;
    const name = rule.name.trim() || t('unnamedRule');
    title.textContent = name;
    preview.textContent = rule.message.trim() || t('defaultPreview');
    summary.setAttribute('aria-expanded', String(expanded));
    summary.setAttribute('aria-label', `${t(expanded ? 'collapseRule' : 'expandRule')}: ${name}`);
    editor.hidden = !expanded;
    card.classList.toggle('is-expanded', expanded);
    card.classList.toggle('is-disabled', !rule.enabled);
    checkbox.checked = rule.enabled;
    checkbox.setAttribute('aria-label', `${t('ruleEnabled')}: ${name}`);
    status.textContent = t(rule.enabled ? 'ruleOn' : 'ruleOff');
    const saved = service.state.saved?.rules.find(item => item.id === rule.id);
    const modified = !!saved && JSON.stringify(saved) !== JSON.stringify(rule);
    badge.hidden = !!saved && !modified;
    badge.textContent = t(saved ? 'ruleModified' : 'ruleNew');
    view.validate.textContent = t(view.tester.root.hidden ? 'validateRule' : 'closeRuleTest');
  }

  /**
   * Sets a page-owned disabled state. Marked with data-state-disabled so the auth RBAC pass,
   * which re-applies permission disabling to data-require-permission controls, keeps it.
   */
  function gate(control: HTMLButtonElement | HTMLInputElement | null | undefined, disabled: boolean): void {
    if (!control) return;
    control.dataset.stateDisabled = String(disabled);
    control.disabled = disabled;
    // Action dispatch ignores aria-disabled="true", so a stale value from an earlier RBAC pass must go too.
    control.setAttribute('aria-disabled', String(disabled));
  }

  function updateControls(): void {
    const state = service.state;
    const writable = dependencies.canWrite() && !!state.config && !state.busy;
    const readable = dependencies.canRead() && !!state.config && !state.busy;
    const dirty = service.isDirty();
    const ctl = (id: string) => el<HTMLButtonElement | HTMLInputElement>(doc, `tool-guard-${id}`);
    gate(ctl('enabled'), !writable);
    gate(ctl('add'), !writable || (state.config?.rules.length ?? 0) >= 100);
    gate(ctl('save'), !writable || !dirty);
    gate(ctl('reset'), !writable || !dirty);
    gate(ctl('test'), !dependencies.canRead() || !state.config || state.busy || state.testing);
    gate(ctl('open-test'), !readable);
    const stateEl = el(doc, 'tool-guard-save-state');
    if (stateEl) {
      stateEl.textContent = state.busy ? t('loading') : state.config ? t(dirty ? 'unsaved' : 'savedState') : '';
      stateEl.classList.toggle('is-dirty', dirty);
    }
    const protection = el(doc, 'tool-guard-protection-status');
    if (protection && state.config) {
      protection.textContent = t(state.config.enabled ? 'protectionOn' : 'protectionOff');
      protection.classList.toggle('is-off', !state.config.enabled);
    }
    const count = el(doc, 'tool-guard-rule-count');
    if (count && state.config) {
      count.textContent = t('ruleCount', {
        enabled: state.config.rules.filter(rule => rule.enabled).length,
        total: state.config.rules.length,
      });
    }
    ruleViews.forEach(view => {
      [view.checkbox, view.remove, ...Object.values(view.fields)].forEach(input => { if (input) input.disabled = !writable; });
      // Reading and collapsing an editor never needs write permission.
      view.summary.disabled = false;
      view.close.disabled = false;
      view.validate.disabled = !readable;
      updateLocalTestControls(view.tester);
      updateRuleView(view);
    });
    const draft = state.addDraft;
    if (draft) {
      const draftView = draftElements.get(draft);
      if (draftView) {
        Object.values(draftView.fields).forEach(input => { if (input) input.disabled = !writable; });
        const confirm = el<HTMLButtonElement>(doc, 'tool-guard-add-confirm');
        if (confirm) {
          gate(confirm, !writable || !dependencies.canRead() || draft.adding);
          confirm.textContent = t(draft.adding ? 'addingRule' : 'addToList');
        }
        updateLocalTestControls(draftView.tester);
      }
    }
  }

  // ---- rules list ----
  const draftElements = new WeakMap<AddDraft, { fields: Partial<Record<RuleField, HTMLInputElement | HTMLTextAreaElement>>; tester: LocalTest }>();

  function createLocalTest(rule: GuardRule, prefix: string, fields: LocalTest['fields']): LocalTest {
    const root = doc.createElement('section');
    root.className = 'tool-guard-local-test';
    const title = text(doc, 'h4', t('singleTestTitle')) as HTMLElement;
    title.id = `tool-guard-${prefix}-title`;
    root.setAttribute('aria-labelledby', title.id);
    root.append(title, text(doc, 'p', t('singleTestHint'), 'tool-guard-hint'));

    const tester = { rule, root, fields, testing: false, disposed: false, revision: 0 } as LocalTest;
    const toolField = doc.createElement('div');
    toolField.className = 'tool-guard-field';
    const tool = doc.createElement('input');
    tool.id = `tool-guard-${prefix}-tool`;
    tool.value = 'http_request';
    tool.spellcheck = false;
    tool.type = 'text';
    tool.maxLength = 512;
    tool.autocomplete = 'off';
    const toolLabel = text(doc, 'label', t('testTool')) as HTMLLabelElement;
    toolLabel.htmlFor = tool.id;
    tool.addEventListener('input', () => { tool.removeAttribute('aria-invalid'); invalidateLocal(tester); });
    toolField.append(toolLabel, tool);

    const argsField = doc.createElement('div');
    argsField.className = 'tool-guard-field';
    const args = doc.createElement('textarea');
    args.id = `tool-guard-${prefix}-arguments`;
    args.value = '{"url": "https://example.gov.cn"}';
    args.spellcheck = false;
    args.rows = 4;
    args.className = 'tool-guard-test-arguments';
    const argsLabel = text(doc, 'label', t('testArguments')) as HTMLLabelElement;
    argsLabel.htmlFor = args.id;
    args.addEventListener('input', () => { args.removeAttribute('aria-invalid'); invalidateLocal(tester); });
    argsField.append(argsLabel, args);
    root.append(toolField, argsField);

    const run = text(doc, 'button', t('test'), 'btn-secondary tool-guard-test-run') as HTMLButtonElement;
    run.id = `tool-guard-${prefix}-run`;
    run.type = 'button';
    run.addEventListener('click', () => { void testLocal(tester); });

    const feedbackEl = text(doc, 'div', '', 'tool-guard-feedback');
    feedbackEl.id = `tool-guard-${prefix}-feedback`;
    feedbackEl.hidden = true;
    feedbackEl.setAttribute('role', 'status');
    const result = text(doc, 'div', '', 'tool-guard-test-result');
    result.id = `tool-guard-${prefix}-result`;
    result.hidden = true;
    result.setAttribute('role', 'status');
    const output = text(doc, 'div', '', 'tool-guard-local-output');
    output.id = `tool-guard-${prefix}-output`;
    const placeholder = text(doc, 'p', t('testReadyHint'), 'tool-guard-test-placeholder');
    placeholder.id = `tool-guard-${prefix}-status`;
    placeholder.setAttribute('role', 'status');
    output.append(placeholder, feedbackEl, result);
    root.append(run, output);

    Object.assign(tester, { tool, args, run, output, feedback: feedbackEl, result, placeholder });
    updateLocalTestControls(tester);
    return tester;
  }

  function invalidateLocal(tester: LocalTest, statusKey = 'testChanged'): void {
    tester.revision += 1;
    tester.result.hidden = true;
    tester.result.replaceChildren();
    showLocal(tester.feedback, null);
    tester.placeholder.textContent = t(statusKey);
    tester.placeholder.hidden = false;
  }

  function disposeLocal(tester: LocalTest | undefined): void {
    if (!tester) return;
    tester.disposed = true;
    invalidateLocal(tester);
  }

  function renderResult(target: HTMLElement, result: GuardTestResult, enabled: boolean, single: boolean): void {
    target.replaceChildren();
    target.hidden = false;
    target.classList.toggle('is-blocked', result.blocked);
    target.classList.toggle('is-single', single);
    const headline = single
      ? (result.blocked ? 'singleMatched' : 'singleNotMatched')
      : (result.blocked ? 'blocked' : enabled ? 'notBlocked' : 'disabledResult');
    target.append(text(doc, 'strong', t(headline)));
    if (single) target.append(text(doc, 'p', t('singleResultHint'), 'tool-guard-single-result-hint'));
    if (result.blocked && result.match) {
      const rows: [string, string][] = [
        ['matchedRule', result.match.ruleName || result.match.ruleId || ''],
        ['matchedText', result.match.matchedText],
        ['matchedMessage', result.match.message],
      ];
      for (const [key, value] of rows) {
        target.append(text(doc, 'p', t(key), 'tool-guard-result-label'));
        target.append(text(doc, 'pre', value, 'tool-guard-result-value'));
      }
    }
  }

  /** Points a validation error at its editor field, opening the rule when needed. */
  function reveal(error: unknown, tester?: LocalTest): void {
    if (!(error instanceof GuardError)) return;
    if (tester) {
      const field = error.field;
      const input = (field && tester.fields[field]) ?? undefined;
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!input.disabled && (service.state.addDraft || service.state.openRuleId === tester.rule.id)) input.focus();
      }
      return;
    }
    const rule = error.ruleId
      ? service.state.config?.rules.find(item => item.id === error.ruleId)
      : service.state.config?.rules[error.ruleIndex ?? -1];
    const view = rule ? ruleViews.get(rule.id) : undefined;
    if (!view || !rule) return;
    service.setOpenRule(rule.id);
    const input = view.fields[error.field ?? 'pattern'];
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (input.disabled) view.summary.focus();
      else input.focus();
    }
  }

  async function testLocal(tester: LocalTest): Promise<void> {
    if (!dependencies.canRead() || service.state.busy || tester.testing || tester.disposed) return;
    invalidateLocal(tester, 'testing');
    const revision = tester.revision;
    tester.testing = true;
    updateLocalTestControls(tester);
    try {
      if (!tester.tool.value.trim()) {
        tester.tool.setAttribute('aria-invalid', 'true');
        throw new GuardError(t('toolRequired'));
      }
      await service.testRule(tester.rule, tester.tool.value, tester.args.value, tester === draftTesterRef ? 'draft' : 'rule');
      if (tester.disposed || revision !== tester.revision) return;
    } catch (error) {
      if (tester.disposed || revision !== tester.revision) return;
      tester.placeholder.hidden = true;
      showLocal(tester.feedback, `${t('testFailed')}: ${(error as Error).message}`);
      if (error instanceof GuardError && !error.field) tester.args.setAttribute('aria-invalid', 'true');
      reveal(error, tester);
    } finally {
      tester.testing = false;
      updateLocalTestControls(tester);
    }
  }

  let draftTesterRef: LocalTest | undefined;

  function renderRules(): void {
    const target = el(doc, 'tool-guard-rules');
    const config = service.state.config;
    if (!target || !config) return;
    ruleViews.forEach(view => disposeLocal(view.tester));
    target.replaceChildren();
    ruleViews.clear();
    // Render-time cleanup writes state silently: setOpenRule would emit a change and re-enter render.
    if (service.state.openRuleId && !config.rules.some(rule => rule.id === service.state.openRuleId)) {
      service.state.openRuleId = null;
    }
    if (!config.rules.length) target.append(text(doc, 'p', t('emptyRules'), 'tool-guard-empty'));

    config.rules.forEach((rule, index) => {
      const card = doc.createElement('article');
      card.className = 'tool-guard-rule';
      card.id = `tool-guard-rule-${index}`;
      const header = doc.createElement('div');
      header.className = 'tool-guard-rule-header';

      const summary = doc.createElement('button');
      summary.type = 'button';
      summary.id = `${card.id}-summary`;
      summary.className = 'tool-guard-rule-summary';
      summary.setAttribute('aria-controls', `${card.id}-editor`);
      summary.addEventListener('click', () => {
        service.setOpenRule(service.state.openRuleId === rule.id ? null : rule.id);
      });
      const overview = doc.createElement('span');
      overview.className = 'tool-guard-rule-overview';
      const title = text(doc, 'span', '', 'tool-guard-rule-name');
      title.id = `${card.id}-title`;
      const preview = text(doc, 'span', '', 'tool-guard-rule-preview');
      preview.id = `${card.id}-preview`;
      overview.append(title, preview);
      const badge = text(doc, 'span', '', 'tool-guard-rule-badge');
      badge.id = `${card.id}-badge`;
      const chevron = text(doc, 'span', '›', 'tool-guard-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      summary.append(text(doc, 'span', String(index + 1).padStart(2, '0'), 'tool-guard-rule-number'), overview, badge, chevron);

      const actionsEl = doc.createElement('div');
      actionsEl.className = 'tool-guard-rule-actions';
      const toggle = doc.createElement('label');
      toggle.className = 'tool-guard-toggle tool-guard-switch';
      const checkbox = doc.createElement('input');
      checkbox.id = `${card.id}-enabled`;
      checkbox.type = 'checkbox';
      checkbox.className = 'theme-checkbox';
      checkbox.checked = rule.enabled;
      checkbox.addEventListener('change', () => {
        if (!dependencies.canWrite() || service.state.busy) return;
        rule.enabled = checkbox.checked;
        service.invalidateTest();
      });
      const status = text(doc, 'span', '');
      toggle.append(checkbox, status);
      actionsEl.append(toggle);

      const editor = doc.createElement('div');
      editor.className = 'tool-guard-rule-editor';
      editor.id = `${card.id}-editor`;
      editor.setAttribute('aria-labelledby', title.id);
      const fields: RuleView['fields'] = {};
      const onInput = () => { service.invalidateTest(); };
      const grid = doc.createElement('div');
      grid.className = 'tool-guard-editor-grid';
      grid.append(
        ruleField(doc, t, rule, index, 'name', 'ruleName', false, fields, onInput),
        ruleField(doc, t, rule, index, 'pattern', 'pattern', true, fields, onInput),
        ruleField(doc, t, rule, index, 'message', 'message', true, fields, onInput),
      );

      const footer = doc.createElement('div');
      footer.className = 'tool-guard-editor-footer';
      const remove = text(doc, 'button', t('deleteRule'), 'btn-secondary tool-guard-delete') as HTMLButtonElement;
      remove.id = `${card.id}-delete`;
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (!dependencies.canWrite() || service.state.busy) return;
        service.deleteRule(rule.id);
      });
      const close = text(doc, 'button', t('closeEditor'), 'btn-secondary tool-guard-close') as HTMLButtonElement;
      close.id = `${card.id}-close`;
      close.type = 'button';
      close.addEventListener('click', () => { service.setOpenRule(null); summary.focus(); });
      const validate = text(doc, 'button', t('validateRule'), 'btn-secondary tool-guard-rule-validate') as HTMLButtonElement;
      validate.id = `${card.id}-validate`;
      validate.type = 'button';

      const tester = createLocalTest(rule, `rule-${index}-test`, fields);
      tester.root.id = `${card.id}-test-panel`;
      tester.root.classList.add('tool-guard-inline-test');
      tester.root.hidden = true;
      validate.setAttribute('aria-controls', tester.root.id);
      validate.setAttribute('aria-expanded', 'false');
      validate.addEventListener('click', () => {
        if (!tester.root.hidden) {
          tester.root.hidden = true;
          validate.setAttribute('aria-expanded', 'false');
          updateRuleView(ruleViews.get(rule.id) as RuleView);
        } else {
          openTest(rule.id);
        }
      });

      const editorActions = doc.createElement('div');
      editorActions.className = 'tool-guard-editor-actions';
      editorActions.append(validate, close);
      footer.append(remove, editorActions);
      editor.append(grid, footer, tester.root);
      header.append(summary, actionsEl);
      card.append(header, editor);
      ruleViews.set(rule.id, { rule, card, summary, editor, title, preview, badge, status, checkbox, remove, close, validate, fields, tester });
      target.append(card);
    });
    updateControls();
  }

  function openTest(ruleId?: string): void {
    if (!dependencies.canRead() || !service.state.config || service.state.busy) return;
    if (ruleId !== undefined) {
      const view = ruleViews.get(ruleId);
      if (!view) return;
      service.setOpenRule(ruleId);
      view.tester.root.hidden = false;
      view.validate.setAttribute('aria-expanded', 'true');
      updateRuleView(view);
      view.tester.args.focus();
      return;
    }
    const panel = el<HTMLDetailsElement>(doc, 'tool-guard-test-panel');
    if (panel) {
      panel.open = true;
      panel.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    el<HTMLTextAreaElement>(doc, 'tool-guard-test-arguments')?.focus({ preventScroll: true });
  }

  function render(): void {
    const enabled = el<HTMLInputElement>(doc, 'tool-guard-enabled');
    if (service.state.config && enabled) enabled.checked = service.state.config.enabled;
    renderRules();
    updateControls();
  }

  // ---- add dialog ----
  function openAddDialog(): void {
    if (!dependencies.canWrite() || !service.state.config || service.state.busy) return;
    const dialog = el<HTMLDialogElement>(doc, 'tool-guard-add-dialog');
    if (!dialog || service.state.addDraft) return;
    let draft: AddDraft;
    try {
      draft = service.startAdd(t('defaultMessage'));
    } catch (error) {
      feedback((error as Error).message, true);
      return;
    }
    const fields: Partial<Record<RuleField, HTMLInputElement | HTMLTextAreaElement>> = {};
    const onInput = () => { service.touchDraft(); };
    const fieldsHost = el(doc, 'tool-guard-add-fields');
    const rule = draft.rule;
    fieldsHost?.replaceChildren(
      ruleField(doc, t, rule, 'draft', 'name', 'ruleName', false, fields, onInput),
      ruleField(doc, t, rule, 'draft', 'pattern', 'pattern', true, fields, onInput),
      ruleField(doc, t, rule, 'draft', 'message', 'message', true, fields, onInput),
    );
    const tester = createLocalTest(rule, 'draft-test', fields);
    tester.output.setAttribute('role', 'region');
    tester.output.setAttribute('aria-label', t('testResultLabel'));
    draftTesterRef = tester;
    el(doc, 'tool-guard-add-test')?.replaceChildren(tester.root);
    showLocal(el(doc, 'tool-guard-add-feedback') as HTMLElement, null);
    draftElements.set(draft, { fields, tester });
    if (!dialog.dataset.guardBound) {
      dialog.dataset.guardBound = 'true';
      const onCancel = (event: Event) => { event.preventDefault(); closeAddDialog(); };
      const onClose = () => { if (!dialog.open) closeAddDialog(); };
      dialog.addEventListener('cancel', onCancel);
      dialog.addEventListener('close', onClose);
      dialog.addEventListener('keydown', trapTab);
      disposers.push(() => {
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('close', onClose);
        dialog.removeEventListener('keydown', trapTab);
      });
    }
    updateControls();
    dialog.showModal();
    fields.name?.focus();
  }

  function trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = el(doc, 'tool-guard-add-dialog');
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button, input, textarea')]
      .filter(input => !(input as HTMLButtonElement).disabled && !input.hidden);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first && event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (last && !event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function closeAddDialog(): void {
    // Also runs after a successful commit, when the service has already cleared the draft.
    const draft = service.state.addDraft;
    const dialog = el<HTMLDialogElement>(doc, 'tool-guard-add-dialog');
    if (draft) {
      disposeLocal(draftElements.get(draft)?.tester);
      service.cancelAdd();
    }
    if (dialog?.open) dialog.close();
    el(doc, 'tool-guard-add-fields')?.replaceChildren();
    el(doc, 'tool-guard-add-test')?.replaceChildren();
    showLocal(el(doc, 'tool-guard-add-feedback') as HTMLElement, null);
    updateControls();
  }

  async function commitAdd(): Promise<void> {
    const draft = service.state.addDraft;
    if (!draft || !dependencies.canWrite() || !dependencies.canRead() || service.state.busy || draft.adding) return;
    const entry = draftElements.get(draft);
    const feedbackEl = el(doc, 'tool-guard-add-feedback') as HTMLElement;
    try {
      await service.commitAdd(draft);
      if (service.state.addDraft !== draft) {
        closeAddDialog();
        feedback(t('ruleAdded'));
        const added = service.state.config?.rules.find(rule => rule.id === draft.rule.id);
        if (added) ruleViews.get(added.id)?.summary.focus();
      }
    } catch (error) {
      showLocal(feedbackEl, `${t('addFailed')}: ${(error as Error).message}`);
      if (entry) reveal(error, entry.tester);
    }
  }

  // ---- lifecycle ----
  function bind(): () => void {
    const offService = service.subscribe(() => { render(); });
    const offTests = service.onTestResult(({ scope, ruleId, result, enabled }) => {
      if (scope === 'global') {
        const target = el(doc, 'tool-guard-test-result');
        if (target) renderResult(target, result, enabled, false);
        return;
      }
      const tester = scope === 'draft' ? draftTesterRef : ruleId ? ruleViews.get(ruleId)?.tester : undefined;
      if (tester && !tester.disposed) {
        tester.placeholder.hidden = true;
        renderResult(tester.result, result, true, true);
      }
    });
    const offLanguage = (() => {
      const handler = () => { render(); service.invalidateTest(); feedback(null); };
      doc.addEventListener('languagechange', handler);
      return () => doc.removeEventListener('languagechange', handler);
    })();
    disposers.push(offService, offTests, offLanguage);

    for (const id of ['tool-guard-test-tool', 'tool-guard-test-arguments']) {
      const field = el<HTMLInputElement | HTMLTextAreaElement>(doc, id);
      if (!field) continue;
      const onInput = () => { field.removeAttribute('aria-invalid'); service.invalidateTest(); };
      field.addEventListener('input', onInput);
      disposers.push(() => field.removeEventListener('input', onInput));
    }

    const unbindActions = [
      actions.register('tool-guard.save', () => { void service.save().then(() => feedback(t('saveSuccess')), error => feedback((error as Error).message, true)); }),
      actions.register('tool-guard.reset', () => { closeAddDialog(); service.reset(); feedback(null); }),
      actions.register('tool-guard.add', openAddDialog),
      actions.register('tool-guard.dialog.close', closeAddDialog),
      actions.register('tool-guard.dialog.commit', (_element, event) => { event.preventDefault(); void commitAdd(); }),
      actions.register('tool-guard.openTest', () => openTest()),
      actions.register('tool-guard.test', () => { void runGlobalTest(); }),
      actions.register('tool-guard.enabled', (element) => { service.setEnabled((element as HTMLInputElement).checked); }),
    ];
    disposers.push(...unbindActions);
    return () => disposers.splice(0).reverse().forEach(dispose => dispose());
  }

  async function runGlobalTest(): Promise<void> {
    if (!dependencies.canRead() || service.state.busy || service.state.testing) return;
    const tool = el<HTMLInputElement>(doc, 'tool-guard-test-tool');
    const args = el<HTMLTextAreaElement>(doc, 'tool-guard-test-arguments');
    const target = el(doc, 'tool-guard-test-result');
    if (target) { target.hidden = true; target.replaceChildren(); }
    service.invalidateTest();
    try {
      await service.testAll(tool?.value ?? '', args?.value ?? '');
    } catch (error) {
      feedback(`${t('testFailed')}: ${(error as Error).message}`, true);
      if (error instanceof GuardError && !error.field) args?.setAttribute('aria-invalid', 'true');
      reveal(error);
    }
  }

  return {
    bind,
    render,
    loadFeedback: feedback,
    dispose(): void {
      ruleViews.forEach(view => disposeLocal(view.tester));
      disposers.splice(0).reverse().forEach(dispose => dispose());
    },
  };
}

export type ToolGuardView = ReturnType<typeof createToolGuardView>;
